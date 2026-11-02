"""Pollen AI Cartoon.

Redraws a video so the people and things in it become cartoon characters of
themselves (toon, anime, kungfu). Runs on a free Kaggle or Colab GPU: the
notebook ai/pollen_cartoon.ipynb installs the libraries, downloads this file
and calls app(), which shows a point-and-click panel.

How a clip is drawn:
  1. frames are cut at a fixed rate and pose + line art is traced from each one
  2. the clip is drawn in overlapping 16-frame chunks with AnimateDiff (video to
     video), OpenPose and line-art ControlNets, and AnimateLCM for few-step sampling
  3. the first chunk's middle frame becomes the character's "model sheet": every
     later chunk is conditioned on it through IP-Adapter and starts from the last
     frames already drawn, so the character keeps one design all the way through
  4. finished frames go to disk as they are made, so any length fits in memory
     and an interrupted run carries on where it stopped
"""
import base64, gc, glob, hashlib, json, os, re, shutil, subprocess, sys, time, traceback, warnings

# hide library chatter (deprecations, optional extras, token hints); real errors still show
warnings.filterwarnings("ignore")
for _k in ("HF_HUB_VERBOSITY", "TRANSFORMERS_VERBOSITY", "DIFFUSERS_VERBOSITY"):
    os.environ[_k] = "error"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

from PIL import Image

IN_COLAB = "google.colab" in sys.modules
IN_KAGGLE = os.path.isdir("/kaggle/working")
BATCH = os.environ.get("KAGGLE_KERNEL_RUN_TYPE") == "Batch"  # "Save & Run All" on Kaggle
OUT = "/kaggle/working" if IN_KAGGLE else "/content" if IN_COLAB else os.getcwd()
TMP = os.path.join("/tmp" if os.path.isdir("/tmp") else OUT, "pollen")  # work files, kept out of Output
EXTS = (".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v")

NEG = ("photo, photorealistic, realistic skin, worst quality, low quality, blurry, jpeg artifacts, "
       "deformed, extra fingers, extra limbs, bad anatomy, watermark, text, signature")
STYLES = {
    "toon": dict(
        label="Toon", blurb="Flat 2D adult cartoon: thick black outlines, bold flat colour, big round eyes.",
        base="frankjoshua/toonyou_beta6",
        prompt="2d adult animated tv cartoon, flat colors, thick black outlines, simple shapes, "
               "bold saturated colors, cel shaded, cartoon character, big round eyes, clean vector art",
        neg="3d render, shading gradients, painterly", strength=0.08, pose=0.75, line=0.55),
    "anime": dict(
        label="Anime", blurb="Japanese anime: cel shading, clean line art, expressive eyes, painted backgrounds.",
        base="Meina/MeinaMix_V11",
        prompt="anime screencap, anime character, cel shading, clean crisp line art, detailed anime eyes, "
               "vibrant colors, beautiful painted background, anime film still, masterpiece",
        neg="3d, western cartoon", strength=0.0, pose=0.8, line=0.6),
    "kungfu": dict(
        label="Kung Fu", blurb="3D animated feature film: stylised 3D characters, warm golden cinematic light.",
        base="stablediffusionapi/disney-pixar-cartoon",
        prompt="3d animated feature film still, stylized 3d cartoon character, big expressive eyes, "
               "soft cinematic lighting, warm golden hour light, rich detailed environment, octane render",
        neg="2d, flat, sketch, anime", strength=0.03, pose=0.75, line=0.5),
}
QUALITY = {
    "fast": dict(label="Fast", size=448, fps=8, steps=8, sec=3.0),
    "balanced": dict(label="Balanced", size=512, fps=8, steps=10, sec=4.5),
    "best": dict(label="Best", size=576, fps=12, steps=12, sec=7.0),
}  # sec: rough T4 seconds per drawn frame, only used for the estimate shown before starting
CHUNK, OVER = 16, 4  # frames per chunk, frames shared between neighbouring chunks
CARRY = 0.6          # how much a chunk starts from the frames already drawn
REF_SCALE, FIRST_SCALE = 0.55, 0.25  # IP-Adapter pull: model sheet / real footage (first chunk)


# ---- video in and out ---------------------------------------------------------

def sh(*cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr.strip()[-600:]}")
    return r.stdout


def duration(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0.0


def clock(sec):
    sec = int(round(sec))
    return f"{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def find_videos():
    """Videos attached to the notebook (Kaggle datasets) or sitting next to it."""
    found = []
    for root in dict.fromkeys(["/kaggle/input", OUT, os.path.join(TMP, "in")]):
        for d, _, files in os.walk(root, followlinks=True):
            if d.startswith(TMP) and not d.startswith(os.path.join(TMP, "in")):
                continue
            found += [os.path.join(d, f) for f in files
                      if f.lower().endswith(EXTS) and not f.startswith(("pollen_", "compare_"))]
    return sorted(found)


def fetch(url):
    """Downloads a video from a Google Drive, Dropbox or direct link."""
    url, dest = url.strip(), os.path.join(TMP, "in")
    os.makedirs(dest, exist_ok=True)
    if "dropbox.com" in url:
        url = url.replace("dl=0", "dl=1") if "dl=0" in url else url + ("&" if "?" in url else "?") + "dl=1"
    if "drive.google.com" in url or "docs.google.com" in url:
        import gdown
        path = gdown.download(url, output=dest + os.sep, quiet=True, fuzzy=True)
        if not path:
            raise RuntimeError("Google Drive wouldn't share the file. In Drive, set Share to "
                               "\"Anyone with the link\" and try again.")
        return path
    import requests
    name = re.sub(r"[^\w.-]", "_", url.split("?")[0].rstrip("/").split("/")[-1]) or "video"
    if not name.lower().endswith(EXTS):
        name += ".mp4"
    path = os.path.join(dest, name)
    with requests.get(url, stream=True, timeout=60, headers={"User-Agent": "Mozilla/5.0"}) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for part in r.iter_content(1 << 20):
                f.write(part)
    return path


def save_upload(value):
    """Writes a FileUpload widget's file to disk (ipywidgets 7 and 8 store it differently)."""
    if isinstance(value, dict):
        items = [dict(name=k, content=v["content"]) for k, v in value.items()]
    else:
        items = list(value)
    if not items:
        return None
    item = items[-1]
    dest = os.path.join(TMP, "in")
    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, re.sub(r"[^\w.-]", "_", os.path.basename(item["name"])))
    with open(path, "wb") as f:
        f.write(bytes(item["content"]))
    return path


class Clip:
    """A stretch of a video cut into frames, with pose and line art traced from each frame."""

    def __init__(self, src, start, end, quality):
        q = QUALITY[quality]
        self.src, self.start, self.end, self.fps, self.size = src, float(start), float(end), q["fps"], q["size"]
        st = os.stat(src)
        key = f"{os.path.abspath(src)}|{st.st_size}|{st.st_mtime}|{self.start:.2f}|{self.end:.2f}|{self.fps}|{self.size}"
        self.dir = os.path.join(TMP, hashlib.sha1(key.encode()).hexdigest()[:12])
        self.name = re.sub(r"[^\w-]", "_", os.path.splitext(os.path.basename(src))[0])[:40]

    def path(self, kind, i):
        return os.path.join(self.dir, kind, f"{i:05d}.png")

    def frame(self, i): return Image.open(self.path("frames", i)).convert("RGB")
    def pose(self, i): return Image.open(self.path("pose", i)).convert("RGB")
    def line(self, i): return Image.open(self.path("line", i)).convert("RGB")

    def cut(self):
        fr = os.path.join(self.dir, "frames")
        audio = os.path.join(self.dir, "audio.m4a")
        if not os.path.exists(os.path.join(self.dir, "cut.ok")):
            shutil.rmtree(self.dir, ignore_errors=True)
            os.makedirs(fr)
            # long side = size, short side a multiple of 8 (phone rotation is applied first)
            s = self.size
            vf = f"fps={self.fps},scale='if(gt(iw,ih),{s},-8)':'if(gt(iw,ih),-8,{s})':flags=lanczos"
            span = ["-ss", self.start, "-t", self.end - self.start, "-i", self.src]
            sh("ffmpeg", "-y", "-v", "error", *span, "-vf", vf, "-start_number", 0, f"{fr}/%05d.png")
            try:
                sh("ffmpeg", "-y", "-v", "error", *span, "-vn", "-c:a", "aac", audio)
            except RuntimeError:
                pass  # no sound track
            open(os.path.join(self.dir, "cut.ok"), "w").close()
        self.n = len(glob.glob(f"{fr}/*.png"))
        if not self.n:
            raise RuntimeError("No frames came out of that part of the video. Check the start and end times.")
        self.W, self.H = Image.open(self.path("frames", 0)).size
        self.audio = audio if os.path.exists(audio) and os.path.getsize(audio) > 1000 else None

    def trace(self, progress=lambda i, n: None):
        """Pose keeps bodies, hands and faces moving like the real people; line art keeps shapes."""
        if os.path.exists(os.path.join(self.dir, "trace.ok")):
            return
        import torch
        from controlnet_aux import LineartDetector, OpenposeDetector
        os.makedirs(os.path.join(self.dir, "pose"), exist_ok=True)
        os.makedirs(os.path.join(self.dir, "line"), exist_ok=True)
        pose_det = OpenposeDetector.from_pretrained("lllyasviel/Annotators").to("cuda")
        line_det = LineartDetector.from_pretrained("lllyasviel/Annotators").to("cuda")
        for i in range(self.n):
            if not (os.path.exists(self.path("pose", i)) and os.path.exists(self.path("line", i))):
                f = self.frame(i)
                pose_det(f, detect_resolution=512, image_resolution=512, include_hand=True,
                         include_face=True).resize((self.W, self.H)).save(self.path("pose", i))
                line_det(f, detect_resolution=512, image_resolution=512).resize((self.W, self.H)).save(self.path("line", i))
            progress(i + 1, self.n)
        del pose_det, line_det
        gc.collect()
        torch.cuda.empty_cache()
        open(os.path.join(self.dir, "trace.ok"), "w").close()


def encode(clip, drawn, style, smooth=False):
    """Builds the cartoon MP4 (24 fps, twice the size, original sound) and a side-by-side comparison."""
    motion = "minterpolate=fps=24:mi_mode=mci" if smooth else "fps=24"
    out = os.path.join(OUT, f"pollen_{clip.name}_{style}.mp4")
    cmp_out = os.path.join(OUT, f"compare_{clip.name}_{style}.mp4")
    aud = ["-i", clip.audio] if clip.audio else []
    amap = ["-map", "1:a", "-c:a", "aac", "-shortest"] if clip.audio else []
    sh("ffmpeg", "-y", "-v", "error", "-framerate", clip.fps, "-i", f"{drawn}/%05d.png", *aud,
       "-map", "0:v", *amap, "-vf", f"{motion},scale=iw*2:ih*2:flags=lanczos,format=yuv420p",
       "-c:v", "libx264", "-crf", 20, "-movflags", "+faststart", out)
    aud_i = ["-i", clip.audio] if clip.audio else []
    amap = ["-map", "2:a", "-c:a", "aac", "-shortest"] if clip.audio else []
    sh("ffmpeg", "-y", "-v", "error", "-framerate", clip.fps, "-i", os.path.join(clip.dir, "frames", "%05d.png"),
       "-framerate", clip.fps, "-i", f"{drawn}/%05d.png", *aud_i,
       "-filter_complex", "[0][1]hstack,fps=24,format=yuv420p[v]", "-map", "[v]", *amap,
       "-c:v", "libx264", "-crf", 22, "-movflags", "+faststart", cmp_out)
    return out, cmp_out


# ---- drawing ------------------------------------------------------------------

def _patch_peft():
    # Kaggle ships an old torchao that makes peft refuse to load LoRAs; nothing here uses torchao
    try:
        import peft.import_utils, peft.tuners.lora.torchao
        peft.import_utils.is_torchao_available = peft.tuners.lora.torchao.is_torchao_available = lambda: False
    except ImportError:
        pass


class Engine:
    """Loads the shared models once and one style at a time."""

    def __init__(self):
        self.shared, self.style, self.pipe = None, None, None

    def load(self, style, say):
        import torch
        from diffusers import (AnimateDiffVideoToVideoControlNetPipeline, AutoencoderKL,
                               ControlNetModel, LCMScheduler, MotionAdapter)
        _patch_peft()
        dt = torch.float16
        if self.shared is None:
            say("Loading the animation model (first time only, about 3 minutes)")
            self.shared = dict(
                motion_adapter=MotionAdapter.from_pretrained("wangfuyun/AnimateLCM", dtype=dt, variant="fp16"),
                controlnet=[ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_openpose", dtype=dt),
                            ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_lineart", dtype=dt)],
                vae=AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", dtype=dt))
        if self.style != style:
            if self.pipe is not None:
                self.pipe, self.style = None, None
                gc.collect()
                torch.cuda.empty_cache()
            say(f"Loading the {STYLES[style]['label']} style (first time only, about 2 minutes)")
            pipe = AnimateDiffVideoToVideoControlNetPipeline.from_pretrained(STYLES[style]["base"], dtype=dt, **self.shared)
            # AnimateLCM: about 8 steps instead of 25+
            pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config, beta_schedule="linear")
            pipe.load_lora_weights("wangfuyun/AnimateLCM", weight_name="AnimateLCM_sd15_t2v_lora.safetensors",
                                   adapter_name="lcm")
            pipe.set_adapters(["lcm"], [0.8])
            # IP-Adapter carries the character's look from the model sheet into every chunk
            pipe.load_ip_adapter("h94/IP-Adapter", subfolder="models", weight_name="ip-adapter-plus_sd15.safetensors")
            pipe.vae.enable_slicing()
            pipe.unet.enable_forward_chunking()
            pipe.set_progress_bar_config(disable=True)
            self.pipe, self.style = pipe.to("cuda"), style
        return self.pipe


ENGINE = Engine()


def draw(clip, style, who, likeness, seed, quality, say=print, progress=lambda done, n, eta: None,
         show_ref=lambda im: None, engine=ENGINE):
    """Draws every frame of the clip in one style; returns the folder of drawn frames. Resumable."""
    import torch
    s, steps = STYLES[style], QUALITY[quality]["steps"]
    tag = hashlib.sha1(f"{style}|{who}|{likeness}|{seed}|{steps}".encode()).hexdigest()[:8]
    d = os.path.join(clip.dir, f"draw_{style}_{tag}")
    tail_dir, state_file, ref_file = os.path.join(d, "tail"), os.path.join(d, "state.json"), os.path.join(d, "ref.png")
    os.makedirs(tail_dir, exist_ok=True)
    done = json.load(open(state_file))["done"] if os.path.exists(state_file) else 0
    tail = [Image.open(p).convert("RGB") for p in sorted(glob.glob(f"{tail_dir}/*.png"))] if done else []
    ref = Image.open(ref_file).convert("RGB") if done and os.path.exists(ref_file) else None
    if ref is not None:
        show_ref(ref)
    if done >= clip.n:
        return d
    if done:
        say(f"Carrying on from frame {done} of {clip.n}")
    pipe = engine.load(style, say)
    strength = min(max(0.85 - 0.35 * likeness + s["strength"], 0.35), 0.95)
    prompt = f"{s['prompt']}, {who.strip() or 'a person'}"
    chunk, t0, made = CHUNK, time.time(), 0
    say(f"Drawing {clip.n} frames")
    while done < clip.n:
        a = done
        b = min(clip.n, a + chunk)
        video = [clip.frame(i) for i in range(a, b)]
        for j, t in enumerate(tail):  # start from what is already drawn
            video[j] = Image.blend(video[j], t, CARRY)
        pipe.set_ip_adapter_scale(REF_SCALE if ref is not None else FIRST_SCALE)
        try:
            with torch.inference_mode():
                out = pipe(
                    video=video, prompt=prompt, negative_prompt=f"{NEG}, {s['neg']}",
                    height=clip.H, width=clip.W, num_inference_steps=steps, guidance_scale=2.0, strength=strength,
                    ip_adapter_image=ref if ref is not None else clip.frame((a + b) // 2),
                    conditioning_frames=[[clip.pose(i) for i in range(a, b)], [clip.line(i) for i in range(a, b)]],
                    controlnet_conditioning_scale=[s["pose"], s["line"]],
                    generator=torch.Generator("cuda").manual_seed(seed), decode_chunk_size=4,
                ).frames[0]
        except torch.cuda.OutOfMemoryError:
            gc.collect()
            torch.cuda.empty_cache()
            if chunk <= 8:
                raise RuntimeError("The GPU ran out of memory even in small pieces. Choose Fast quality and try again.")
            chunk -= 4
            say(f"GPU memory is tight, drawing {chunk} frames at a time instead")
            continue
        out = [im.convert("RGB").resize((clip.W, clip.H), Image.LANCZOS) for im in out]
        for j, t in enumerate(tail):  # fade from the previous chunk into this one
            out[j] = Image.blend(t, out[j], (j + 1) / (len(tail) + 1))
        last = b == clip.n
        keep = out if last else out[:-OVER]
        for i, im in enumerate(keep):
            im.save(os.path.join(d, f"{a + i:05d}.png"))
        if ref is None:
            ref = out[len(out) // 2]
            ref.save(ref_file)
            show_ref(ref)
        tail = [] if last else out[-OVER:]
        shutil.rmtree(tail_dir)
        os.makedirs(tail_dir)
        for j, t in enumerate(tail):
            t.save(os.path.join(tail_dir, f"{j}.png"))
        done = a + len(keep)
        with open(state_file, "w") as f:  # written last, so a crash never skips frames
            json.dump({"done": done}, f)
        made += len(keep)
        progress(done, clip.n, (time.time() - t0) / made * (clip.n - done))
    return d


def make(src, style, start, end, who="", likeness=0.5, quality="balanced", seed=7, smooth=False,
         say=print, progress=lambda frac, text="": None, show_ref=lambda im: None):
    """The whole job for one style: cut, trace, draw, encode. Returns (cartoon mp4, comparison mp4)."""
    clip = Clip(src, start, end, quality)
    say("Cutting the video into frames")
    clip.cut()
    say(f"Reading poses and outlines from {clip.n} frames")
    clip.trace(lambda i, n: progress(0.1 * i / n, f"Reading poses {i}/{n}"))
    drawn = draw(clip, style, who, likeness, seed, quality, say=say, show_ref=show_ref,
                 progress=lambda done, n, eta: progress(0.1 + 0.85 * done / n,
                                                        f"Drawing {done}/{n} frames, about {clock(eta)} left"))
    say("Putting the video together")
    result = encode(clip, drawn, style, smooth)
    progress(1.0, "Done")
    return result


# ---- the panel ------------------------------------------------------------------

CSS = """<style>
.pollen-h{font:800 26px/1.1 system-ui,sans-serif;margin:4px 0 2px;background:linear-gradient(110deg,#ffb21b,#ff5a3c 30%,#ff2bd6 62%,#7b2fff);-webkit-background-clip:text;background-clip:text;color:transparent}
.pollen-step{font:700 15px system-ui,sans-serif;margin:14px 0 4px}
.pollen-note{font:13px/1.45 system-ui,sans-serif;opacity:.8}
.pollen-ok{color:#1a9b4b;font-weight:600}.pollen-err{color:#d33;font-weight:600}
</style>"""


def _download_link(path, label):
    size = os.path.getsize(path)
    if size > 45e6:  # too big to hand to the browser inline
        where = "the Output panel on the right" if IN_KAGGLE else "the Files panel on the left"
        return f"<p class='pollen-note'><b>{label}:</b> {os.path.basename(path)} ({size / 1e6:.0f} MB) is in {where}.</p>"
    data = base64.b64encode(open(path, "rb").read()).decode()
    return (f"<a download='{os.path.basename(path)}' href='data:video/mp4;base64,{data}' "
            f"style='display:inline-block;margin:6px 8px 6px 0;padding:10px 16px;border-radius:999px;"
            f"background:linear-gradient(110deg,#ff5a3c,#ff2bd6);color:#fff;font:600 14px system-ui;"
            f"text-decoration:none'>Download {label} ({size / 1e6:.1f} MB)</a>")


def _preview(path):
    if os.path.getsize(path) > 25e6:
        return ""
    data = base64.b64encode(open(path, "rb").read()).decode()
    return f"<video controls loop autoplay muted playsinline style='max-width:100%;max-height:480px;border-radius:12px' src='data:video/mp4;base64,{data}'></video>"


def app(background=None):
    """Shows the panel. In a Kaggle background run (Save & Run All) it uses `background` instead."""
    if BATCH:
        return _batch(background or {})
    import ipywidgets as w
    from IPython.display import HTML, display

    wide = w.Layout(width="100%", max_width="640px")
    st = {"src": None}

    # 1. video
    mode = w.ToggleButtons(options=[("Upload", "up"), ("Attached / found", "pick"), ("Paste a link", "link")],
                           value="up" if not find_videos() else "pick")
    upload = w.FileUpload(accept="video/*", multiple=False, description="Choose a video")
    up_note = w.HTML("<p class='pollen-note'>Best for clips under about 50 MB. For bigger files, attach them "
                     "as a Kaggle dataset (Add Input) or use a link.</p>")
    pick = w.Dropdown(layout=wide)
    refresh = w.Button(description="Refresh list", icon="refresh")
    link = w.Text(placeholder="Google Drive (Anyone with the link), Dropbox or direct video link", layout=wide)
    fetch_btn = w.Button(description="Get video", icon="download")
    source = w.VBox()
    loaded = w.HTML()
    span = w.FloatRangeSlider(min=0, max=1, value=(0, 1), step=0.5, description="Use", readout_format=".1f",
                              disabled=True, layout=wide, continuous_update=False)
    estimate = w.HTML()

    # 2. style
    style = w.ToggleButtons(options=[(v["label"], k) for k, v in STYLES.items()], value="anime")
    blurb = w.HTML()
    who = w.Text(placeholder="e.g. a young man with short curly hair in a red hoodie", layout=wide)
    look = w.FloatSlider(min=0, max=1, step=0.05, value=0.5, readout=False, layout=w.Layout(width="260px"))
    quality = w.ToggleButtons(options=[(v["label"], k) for k, v in QUALITY.items()], value="balanced")
    seed = w.IntText(value=7, description="Take")
    smooth = w.Checkbox(value=False, description="Smoother motion (less hand-drawn)")
    both = w.Checkbox(value=False, description="Make all three styles")
    extra = w.Accordion(children=[w.VBox([seed, smooth, both])])
    extra.set_title(0, "More options")

    # 3. go
    go = w.Button(description="Make my cartoon", button_style="success", icon="magic",
                  layout=w.Layout(width="260px", height="46px"))
    bar = w.FloatProgress(min=0, max=1, value=0, layout=wide)
    status = w.HTML()
    sheet = w.Output()
    result = w.Output()

    def note(text, kind="note"):
        status.value = f"<p class='pollen-{kind}'>{text}</p>"

    def refresh_list(_=None):
        vids = find_videos()
        # picking an option fires pick's observer, which loads the video
        pick.options = [(f"{os.path.basename(v)}  ({os.path.dirname(v)})", v) for v in vids] or [("No videos found yet", "")]

    def show_source(_=None):
        source.children = {"up": [upload, up_note], "pick": [w.HBox([pick, refresh])],
                           "link": [w.HBox([link, fetch_btn])]}[mode.value]
        if mode.value == "pick":
            refresh_list()

    def update_estimate(_=None):
        if not st["src"]:
            estimate.value = ""
            return
        a, b = span.value
        q = QUALITY[quality.value]
        frames = max(1, int((b - a) * q["fps"]))
        mins = frames * q["sec"] * (3 if both.value else 1) / 60
        estimate.value = (f"<p class='pollen-note'>{clock(b - a)} of video, {frames} drawings. Roughly "
                          f"{max(1, round(mins * 0.7))}-{max(2, round(mins * 1.4))} min on a free GPU"
                          f"{' (plus about 5 min of downloads the first time)' if ENGINE.shared is None else ''}.</p>")

    def use(path):
        dur = duration(path)
        if dur <= 0:
            loaded.value = "<p class='pollen-err'>Couldn't read that file as a video.</p>"
            return
        st["src"] = path
        span.disabled = False
        span.max = max(dur, 0.5)
        span.min = 0
        span.value = (0, min(dur, 30.0))
        loaded.value = (f"<p class='pollen-ok'>Ready: {os.path.basename(path)} ({clock(dur)})</p>"
                        + ("<p class='pollen-note'>Using the first 30 seconds. Drag the ends of the bar to "
                           "choose a different part, or all of it.</p>" if dur > 30 else ""))
        update_estimate()

    def on_upload(change):
        try:
            path = save_upload(change["new"])
            if path:
                use(path)
        except Exception as e:
            loaded.value = f"<p class='pollen-err'>Upload failed: {e}</p>"

    def on_fetch(_):
        if not link.value.strip():
            return
        loaded.value = "<p class='pollen-note'>Downloading the video...</p>"
        try:
            use(fetch(link.value))
        except Exception as e:
            loaded.value = f"<p class='pollen-err'>Couldn't get that video: {e}</p>"

    def on_style(_=None):
        blurb.value = f"<p class='pollen-note'>{STYLES[style.value]['blurb']}</p>"

    def on_go(_):
        if not st["src"]:
            note("Add a video first (step 1).", "err")
            return
        go.disabled = True
        bar.value = 0
        sheet.clear_output()
        result.clear_output()
        styles = list(STYLES) if both.value else [style.value]
        made = []
        try:
            for k, key in enumerate(styles):
                lead = f"{STYLES[key]['label']} ({k + 1}/{len(styles)}): " if len(styles) > 1 else ""

                def show_ref(im, label=STYLES[key]["label"]):
                    with sheet:
                        display(HTML(f"<p class='pollen-step'>{label} character design, kept for the whole video</p>"))
                        im = im.copy()
                        im.thumbnail((360, 360))
                        display(im)

                def progress(frac, text=""):
                    bar.value = (k + frac) / len(styles)
                    if text:
                        note(lead + text)

                made.append(make(st["src"], key, *span.value, who=who.value, likeness=look.value,
                                 quality=quality.value, seed=seed.value, smooth=smooth.value,
                                 say=lambda t: note(lead + t), progress=progress, show_ref=show_ref))
            note("Done! Your cartoon is below.", "ok")
            with result:
                for cartoon, compare in made:
                    display(HTML(_preview(cartoon) + "<br>" + _download_link(cartoon, "cartoon")
                                 + _download_link(compare, "side-by-side")))
                display(HTML("<p class='pollen-note'>Open the cartoon in the Pollen studio (Choose a video) "
                             "to add particles or step inside it.</p>"))
            if IN_COLAB:
                from google.colab import files
                for cartoon, _ in made:
                    files.download(cartoon)
        except Exception as e:
            note(f"Something went wrong: {e}", "err")
            with result:
                traceback.print_exc()
                print("\nPress Make my cartoon again to carry on from where it stopped.")
        finally:
            go.disabled = False

    mode.observe(show_source, "value")
    upload.observe(on_upload, "value")
    pick.observe(lambda c: c["new"] and use(c["new"]), "value")
    refresh.on_click(refresh_list)
    fetch_btn.on_click(on_fetch)
    span.observe(update_estimate, "value")
    quality.observe(update_estimate, "value")
    both.observe(update_estimate, "value")
    style.observe(on_style, "value")
    go.on_click(on_go)
    show_source()
    on_style()

    def step(text):
        return w.HTML(f"<div class='pollen-step'>{text}</div>")

    display(HTML(CSS))
    display(w.VBox([
        w.HTML("<div class='pollen-h'>Pollen · AI Cartoon</div><p class='pollen-note'>Turn the people in your "
               "video into cartoon characters of themselves.</p>"),
        step("1 · Your video"), mode, source, loaded, span, estimate,
        step("2 · Style"), style, blurb,
        w.HTML("<p class='pollen-note'>Who's in it? (optional, helps keep their look)</p>"), who,
        w.HBox([w.HTML("<span class='pollen-note'>More cartoon&nbsp;</span>"), look,
                w.HTML("<span class='pollen-note'>&nbsp;Closer to the video</span>")]),
        w.HTML("<p class='pollen-note'>Quality</p>"), quality, extra,
        step("3 · Make it"), go, bar, status, sheet, result,
    ]))


def _batch(bg):
    """Kaggle "Save & Run All": converts the attached video with the BACKGROUND settings, no clicks needed."""
    vids = find_videos()
    if not vids:
        print("No video attached. Add your video under Input (+ Add Input), then Save & Run All again.")
        return
    src = vids[0]
    style = bg.get("style", "anime")
    end = bg.get("end") or duration(src)
    for key in (list(STYLES) if style == "all" else [style]):
        last = [0.0]

        def progress(frac, text="", key=key):
            if text and (frac - last[0] >= 0.05 or frac >= 1):
                last[0] = frac
                print(f"[{key}] {text}", flush=True)

        out = make(src, key, bg.get("start", 0), end, who=bg.get("who", ""), likeness=bg.get("likeness", 0.5),
                   quality=bg.get("quality", "balanced"), seed=bg.get("seed", 7), smooth=bg.get("smooth", False),
                   say=lambda t, key=key: print(f"[{key}] {t}", flush=True), progress=progress)
        print("saved:", *out, sep="\n  ")
