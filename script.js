const video = document.getElementById('myVideo');
const canvas = document.getElementById('hiddenCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Optimized for frequent reads

let net;

/**
 * 1. Load the AI Model
 */
async function loadAI() {
    console.log("Loading AI...");
    // This loads the BodyPix model into your browser
    net = await bodyPix.load();
    console.log("AI is ready!");
    
    // Once the AI is ready, start the video scanning loop
    scanVideo();
}

/**
 * 2. The Video Processing Loop
 */
function scanVideo() {
    // Ensure the video is playing and has data before scanning
    if (video.paused || video.ended) {
        requestAnimationFrame(scanVideo);
        return;
    }

    // A. Draw the current video frame to the hidden canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // B. Get the color data for every single pixel
    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // C. The "Loop": Skip every 10 pixels to keep it fast
    for (let y = 0; y < canvas.height; y += 10) {
        for (let x = 0; x < canvas.width; x += 10) {
            
            // This math finds the Red, Green, and Blue values in the data array
            // The array is structured as [R, G, B, A, R, G, B, A...]
            const index = (y * canvas.width + x) * 4;
            const r = frameData[index];     // Red
            const g = frameData[index + 1]; // Green
            const b = frameData[index + 2]; // Blue

            // D. Create a particle at position (x, y) with color (r, g, b)
            // (Note: Make sure your drawParticle function is defined!)
            if (typeof drawParticle === "function") {
                drawParticle(x, y, r, g, b);
            }
        }
    }
    
    // Repeat this for the next frame
    requestAnimationFrame(scanVideo);
}

// Start the initialization
loadAI();