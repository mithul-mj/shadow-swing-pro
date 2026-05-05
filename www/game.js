const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fgCanvas = document.getElementById('fgCanvas');
const fgCtx = fgCanvas.getContext('2d');

// --- Configuration ---
const CONFIG = {
    gravity: 0.35,        // Increased gravity for more "weight"
    webLengthMin: 50,
    webLengthMax: 500,    // Increased range
    swingBoost: 1.15,     // More speed on release
    pullForce: 0.5,       // Force when "holding" the swing
    airFriction: 0.985,
    groundFriction: 0.94,
    cameraCatchup: 0.08,
    maxFallSpeed: 16,
    swingElasticity: 0.8, // How much the web "stretches"
    adFrequency: 1.0      // 100% chance for a building to have an ad
};

// --- Ads (Adsterra Placeholders) ---
const AD_TEMPLATES = [
    { type: 'square',    width: 300, height: 250, key: '6072270e29d424cf8f22eca970769190' },
    { type: 'wide',      width: 728, height: 90,  key: 'e5746ef115d17ae9083360afbc4eb307' },
    { type: 'wide_sm',   width: 468, height: 60,  key: 'c3a021b704f4d410018ba1ce0af2962a' },
    { type: 'tall',      width: 160, height: 600, key: 'd07f8172199f22fd10b8e01ef4816e0b' },
    { type: 'tall_sm',   width: 160, height: 300, key: '4cbf7f90735c4e43f0af15227850a108' },
    { type: 'mobile',    width: 320, height: 50,  key: '68e519d6f3b93cabd168d0aa47f013f1' }
];
const AD_SETTINGS = {
    format: 'iframe',
    loadInterval: 1500,
    maxActiveAds: 12
};

let adLoadTimer = 0;
let activeAdCount = 0;

// --- Game State ---
let gameState = {
    running: false,
    score: 0,
    distance: 0,
    cameraX: 0,
    cameraY: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    timeScale: 1.0,
    shake: 0
};

// --- Player ---
const player = {
    x: 100,
    y: 0,
    vx: 5,
    vy: 0,
    radius: 8,
    state: 'falling',
    anchor: null,
    ropeLength: 0,
    grounded: false,
    hasSwung: false,
    animTimer: 0,
    limbAngle: 0,
    trails: []
};

// --- Sprite Pre-processing (Chroma Key) ---
function processSpriteSheet(img, callback) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];
        let brightness = (r + g + b) / 3;
        if (brightness < 45) {
            if (brightness < 25) {
                data[i+3] = 0;
            } else {
                let alphaFactor = (brightness - 25) / 20;
                data[i+3] = Math.floor(data[i+3] * alphaFactor);
            }
        }
    }
    ctx.putImageData(imageData, 0, 0);
    const newImg = new Image();
    newImg.onload = () => callback(newImg);
    newImg.src = canvas.toDataURL();
}

// --- Image Assets ---
const sprites = {
    run: { src: 'assets/sheets/run.png', img: new Image(), loaded: false, cols: 5, rows: 5, totalFrames: 25 },
    swing: { src: 'assets/sheets/swing.png', img: new Image(), loaded: false, cols: 5, rows: 5, totalFrames: 25 },
    bird: { src: 'assets/sheets/bird.png', img: new Image(), loaded: false, cols: 6, rows: 6, totalFrames: 36 }
};

Object.keys(sprites).forEach(key => {
    const s = sprites[key];
    const tempImg = new Image();
    tempImg.onload = () => {
        processSpriteSheet(tempImg, (processed) => {
            s.img = processed;
            s.loaded = true;
        });
    };
    tempImg.src = s.src;
});

// --- Sounds ---
const sounds = {
    thwip: new Audio('assets/sound/thwip.mp3')
};
sounds.thwip.preload = 'auto';
sounds.thwip.volume = 0.1;

function playSound(audioObj) {
    if (audioObj) {
        audioObj.currentTime = 0;
        audioObj.play().catch(e => console.log('Audio play failed:', e));
    }
}

function stopSound(audioObj) {
    if (audioObj) {
        audioObj.pause();
    }
}

// --- World ---
let buildings = [];
let anchors = [];
let particles = [];
let flock = [];

// --- Input ---
let input = {
    active: false
};

// --- Mobile Detection ---
const isMobileDevice = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1);
const isMobile = isMobileDevice;

// --- Portrait Rotation ---
let isPortrait = false;

// --- Mobile Touch State ---
let touchState = {
    startY: 0,
    currentY: 0,
    isSwiping: false,
    climbDirection: 0,
    climbUpActive: false,
    climbDownActive: false,
    btnSize: 60,
    btnMargin: 20,
    btnUpX: 0, btnUpY: 0,
    btnDownX: 0, btnDownY: 0
};

function updateMobileButtonLayout() {
    let s = Math.min(gameState.width, gameState.height) * 0.08;
    touchState.btnSize = Math.max(44, Math.min(s, 70));
    touchState.btnMargin = 20;
    touchState.btnUpX = gameState.width - touchState.btnSize - touchState.btnMargin;
    touchState.btnUpY = gameState.height * 0.35;
    touchState.btnDownX = gameState.width - touchState.btnSize - touchState.btnMargin;
    touchState.btnDownY = gameState.height * 0.35 + touchState.btnSize + 15;
}

function isInsideButton(tx, ty, bx, by, size) {
    let half = size * 0.65;
    let cx = bx + size / 2;
    let cy = by + size / 2;
    return tx >= cx - half && tx <= cx + half && ty >= cy - half && ty <= cy + half;
}

function transformTouchCoords(screenX, screenY) {
    if (isPortrait) {
        let screenW = window.innerWidth;
        return {
            x: screenY,
            y: screenW - screenX
        };
    }
    return { x: screenX, y: screenY };
}

// --- Initialization ---
function init() {
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => {
        setTimeout(resize, 100);
    });

    canvas.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mouseup', handleInputEnd);

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        let touch = e.touches[0];
        let coords = transformTouchCoords(touch.clientX, touch.clientY);
        let tx = coords.x;
        let ty = coords.y;

        if (isMobile && player.state === 'swinging') {
            if (isInsideButton(tx, ty, touchState.btnUpX, touchState.btnUpY, touchState.btnSize)) {
                touchState.climbUpActive = true;
                touchState.climbDirection = -1;
                return;
            }
            if (isInsideButton(tx, ty, touchState.btnDownX, touchState.btnDownY, touchState.btnSize)) {
                touchState.climbDownActive = true;
                touchState.climbDirection = 1;
                return;
            }
        }
        touchState.startY = ty;
        touchState.currentY = ty;
        touchState.isSwiping = false;
        touchState.climbDirection = 0;
        handleInputStart(touch);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 0) return;
        let touch = e.touches[0];
        let coords = transformTouchCoords(touch.clientX, touch.clientY);
        let ty = coords.y;
        touchState.currentY = ty;
        if (player.state === 'swinging') {
            let deltaY = ty - touchState.startY;
            let swipeThreshold = 15;
            if (Math.abs(deltaY) > swipeThreshold) {
                touchState.isSwiping = true;
                let climbSpeed = 3.0;
                let climbAmount = (deltaY > 0 ? 1 : -1) * climbSpeed;
                player.ropeLength += climbAmount;
                if (player.ropeLength < CONFIG.webLengthMin) player.ropeLength = CONFIG.webLengthMin;
                if (player.ropeLength > CONFIG.webLengthMax) player.ropeLength = CONFIG.webLengthMax;
                touchState.startY = ty;
            }
        }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        let isUIElement = e.target && (
            e.target.closest('#game-over') ||
            e.target.closest('button') ||
            e.target.tagName === 'BUTTON'
        );
        if (!isUIElement) {
            e.preventDefault();
        }
        touchState.climbUpActive = false;
        touchState.climbDownActive = false;
        touchState.climbDirection = 0;
        touchState.isSwiping = false;
        handleInputEnd();
    }, { passive: false });

    window.addEventListener('touchcancel', (e) => {
        touchState.climbUpActive = false;
        touchState.climbDownActive = false;
        touchState.climbDirection = 0;
        touchState.isSwiping = false;
        handleInputEnd();
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            if (!input.active) handleInputStart();
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            handleInputEnd();
        }
    });

    window.addEventListener('wheel', (e) => {
        if (player.state === 'swinging') {
            e.preventDefault();
            let climbSpeed = 0.5;
            player.ropeLength += e.deltaY * climbSpeed;
            if (player.ropeLength < CONFIG.webLengthMin) player.ropeLength = CONFIG.webLengthMin;
            if (player.ropeLength > CONFIG.webLengthMax) player.ropeLength = CONFIG.webLengthMax;
        }
    }, { passive: false });

    document.getElementById('restart-btn').addEventListener('click', () => {
        resetGame();
        lastTime = 0;
        requestAnimationFrame(loop);
    });

    document.getElementById('restart-btn').addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetGame();
        lastTime = 0;
        requestAnimationFrame(loop);
    });

    resetGame();
    requestAnimationFrame(loop);
}

function handleInputStart(e) {
    if (!gameState.running) return;
    input.active = true;
    particles.push({
        x: player.x,
        y: player.y,
        vx: 0,
        vy: 0,
        life: 20,
        type: 'input_ripple'
    });
    if (player.state !== 'swinging') {
        tryAttachWeb();
    }
}

function handleInputEnd() {
    input.active = false;
    if (player.state === 'swinging') {
        releaseWeb();
    }
}

function resetGame() {
    gameState.running = true;
    gameState.score = 0;
    gameState.distance = 0;
    gameState.cameraX = 0;
    gameState.cameraY = 0;
    gameState.timeScale = 1.0;
    let startGroundY = gameState.height - 150;
    player.x = 150;
    player.y = startGroundY - player.radius - 2;
    player.vx = 6;
    player.vy = 0;
    player.state = 'falling';
    player.anchor = null;
    player.grounded = true;
    player.hasSwung = false;
    buildings = [];
    anchors = [];
    particles = [];
    flock = [];
    buildings.push({
        x: -200,
        y: gameState.height - 150,
        width: 2000,
        height: 200,
        type: 'ground'
    });
    attachAdToBuilding(buildings[0]);
    buildings[0].adRelX = 600;
    buildings[0].adRelY = -buildings[0].adHeight - 45;
    for (let j = 0; j < 5; j++) {
        flock.push({
            x: Math.random() * 800,
            y: gameState.height - 150,
            state: 'idle',
            vx: 0, vy: 0,
            frame: Math.floor(Math.random() * 10),
            timer: Math.random() * 10,
            facingLeft: Math.random() > 0.5,
            roofLeft: -200, roofRight: 1800,
            walkSpeed: 0.3 + Math.random() * 0.4,
            pauseTimer: Math.random() * 100
        });
    }
    anchors.push({ x: 800, y: 300, type: 'normal' });
    anchors.push({ x: 1200, y: 250, type: 'normal' });
    anchors.push({ x: 1600, y: 350, type: 'normal' });
    anchors.push({ x: 2100, y: 350, type: 'crane' });
    anchors.push({ x: 2400, y: 350, type: 'crane' });
    let craneStartX = 2800;
    let craneY = 250;
    let spacing = 700;
    for (let i = 0; i < 15; i++) {
        anchors.push({ x: craneStartX + (i * spacing), y: craneY, type: 'crane', alignment: 'aligned' });
        if (i % 2 === 0) {
            buildings.push({
                x: craneStartX + (i * spacing) - 100, y: gameState.height - 150, width: 200, height: 2000,
                type: 'building', color: `hsl(${210 + Math.random() * 20}, ${10 + Math.random() * 10}%, ${15 + Math.random() * 10}%)`, windowSeed: Math.random()
            });
            attachAdToBuilding(buildings[buildings.length - 1]);
            let bLeft = craneStartX + (i * spacing) - 100;
            let bRight = bLeft + 200;
            let numBirds = 1 + Math.floor(Math.random() * 3);
            for (let j = 0; j < numBirds; j++) {
                flock.push({
                    x: bLeft + random(10, 190), y: gameState.height - 150, state: 'idle', vx: 0, vy: 0,
                    frame: Math.floor(Math.random() * 10), timer: Math.random() * 10, facingLeft: Math.random() > 0.5,
                    roofLeft: bLeft + 5, roofRight: bRight - 5, walkSpeed: 0.3 + Math.random() * 0.4, pauseTimer: Math.random() * 100
                });
            }
        }
    }
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('score').innerText = '0m';
    const adLayer = document.getElementById('ad-layer');
    if (adLayer) adLayer.innerHTML = '';
    activeAdCount = 0; adLoadTimer = 0;
}

function resize() {
    let screenW = window.innerWidth;
    let screenH = window.innerHeight;
    let overlay = document.getElementById('ui-overlay');
    let adLayer = document.getElementById('ad-layer');
    if (isMobileDevice && screenH > screenW) {
        isPortrait = true;
        gameState.width = screenH; gameState.height = screenW;
        canvas.width = screenH; canvas.height = screenW;
        canvas.style.width = screenH + 'px'; canvas.style.height = screenW + 'px';
        canvas.style.position = 'absolute'; canvas.style.transformOrigin = 'top left';
        canvas.style.transform = 'rotate(90deg) translateY(-100%)';
        canvas.style.top = '0'; canvas.style.left = '0';
        if (overlay) { overlay.style.width = screenH + 'px'; overlay.style.height = screenW + 'px'; overlay.style.transformOrigin = 'top left'; overlay.style.transform = 'rotate(90deg) translateY(-100%)'; }
        if (adLayer) { adLayer.style.width = screenH + 'px'; adLayer.style.height = screenW + 'px'; adLayer.style.transformOrigin = 'top left'; adLayer.style.transform = 'rotate(90deg) translateY(-100%)'; }
        fgCanvas.width = screenH; fgCanvas.height = screenW;
        fgCanvas.style.width = screenH + 'px'; fgCanvas.style.height = screenW + 'px';
        fgCanvas.style.position = 'absolute'; fgCanvas.style.transformOrigin = 'top left';
        fgCanvas.style.transform = 'rotate(90deg) translateY(-100%)';
        fgCanvas.style.top = '0'; fgCanvas.style.left = '0';
    } else {
        isPortrait = false;
        gameState.width = screenW; gameState.height = screenH;
        canvas.width = screenW; canvas.height = screenH;
        fgCanvas.width = screenW; fgCanvas.height = screenH;
        canvas.style.width = ''; canvas.style.height = ''; canvas.style.position = ''; canvas.style.transformOrigin = ''; canvas.style.transform = ''; canvas.style.top = ''; canvas.style.left = '';
        fgCanvas.style.width = ''; fgCanvas.style.height = ''; fgCanvas.style.position = ''; fgCanvas.style.transformOrigin = ''; fgCanvas.style.transform = ''; fgCanvas.style.top = ''; fgCanvas.style.left = '';
        if (overlay) { overlay.style.width = ''; overlay.style.height = ''; overlay.style.transformOrigin = ''; overlay.style.transform = ''; }
        if (adLayer) { adLayer.style.width = ''; adLayer.style.height = ''; adLayer.style.transformOrigin = ''; adLayer.style.transform = ''; }
    }
    updateMobileButtonLayout();
}

let lastTime = 0;
function loop(timestamp) {
    if (!gameState.running) return;
    if (!lastTime) lastTime = timestamp;
    let delta = timestamp - lastTime;
    lastTime = timestamp;
    if (delta > 50) delta = 50;
    let timeScale = delta / 16.666;
    update(timeScale); draw();
    requestAnimationFrame(loop);
}

function update(baseTimeScale = 1.0) {
    let dt = baseTimeScale;
    if (player.state === 'falling' && !player.grounded) { dt = baseTimeScale * 0.4; }
    gameState.timeScale = dt;
    let targetCamX = player.x - gameState.width * 0.3;
    let targetCamY = player.y - gameState.height * 0.5;
    let followSpeedX = 0.15; let followSpeedY = 0.1;
    gameState.cameraX += (targetCamX - gameState.cameraX) * followSpeedX * dt;
    gameState.cameraY += (targetCamY - gameState.cameraY) * followSpeedY * dt;
    if (gameState.cameraY > 200) gameState.cameraY = 200;
    let margin = 50;
    if (player.x < gameState.cameraX + margin) gameState.cameraX = player.x - margin;
    if (player.x > gameState.cameraX + gameState.width - margin) gameState.cameraX = player.x - gameState.width + margin;
    if (player.y < gameState.cameraY + margin) gameState.cameraY = player.y - margin;
    if (player.y > gameState.cameraY + gameState.height - margin) gameState.cameraY = player.y - gameState.height + margin;
    if (gameState.shake > 0) { gameState.cameraX += (Math.random() - 0.5) * gameState.shake; gameState.cameraY += (Math.random() - 0.5) * gameState.shake; gameState.shake *= 0.9; if (gameState.shake < 0.1) gameState.shake = 0; }
    let speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    let zoomInfluence = Math.min(speed / 20, 1.0);
    gameState.cameraX += player.vx * 0.2 * zoomInfluence * dt;
    if (isMobile && player.state === 'swinging' && touchState.climbDirection !== 0) {
        let mobileClimbSpeed = 4.0 * dt;
        player.ropeLength += touchState.climbDirection * mobileClimbSpeed;
        if (player.ropeLength < CONFIG.webLengthMin) player.ropeLength = CONFIG.webLengthMin;
        if (player.ropeLength > CONFIG.webLengthMax) player.ropeLength = CONFIG.webLengthMax;
    }
    if (player.state === 'swinging') { updateSwing(dt); } else { updateFall(dt); }
    player.animTimer += 0.1 * dt;
    generateWorld(); cleanupWorld();
    for (let i = flock.length - 1; i >= 0; i--) {
        let b = flock[i];
        if (b.state === 'idle') {
            b.timer += dt * 5; b.frame = Math.floor(b.timer * 0.1) % 6;
            b.pauseTimer -= dt;
            if (b.pauseTimer <= 0) {
                let walkDir = b.facingLeft ? -1 : 1; b.x += walkDir * b.walkSpeed * dt;
                if (b.x <= b.roofLeft) { b.x = b.roofLeft; b.facingLeft = false; b.pauseTimer = 30 + Math.random() * 80; }
                else if (b.x >= b.roofRight) { b.x = b.roofRight; b.facingLeft = true; b.pauseTimer = 30 + Math.random() * 80; }
                if (Math.random() < 0.005) { b.facingLeft = !b.facingLeft; b.pauseTimer = 40 + Math.random() * 120; }
            }
            let dx = player.x - b.x; let dy = player.y - b.y; let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 200 || (player.grounded && Math.abs(dx) < 400 && dy > -150 && dy < 150)) { b.state = 'flying'; b.vx = (b.x > player.x ? 1 : -1) * random(2, 5); b.vy = -random(3, 6); b.frame = 0; b.facingLeft = b.vx < 0; }
        } else if (b.state === 'flying') { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += -0.15 * dt; b.timer += dt; b.frame = Math.floor(b.timer * 0.5) % sprites.bird.totalFrames; }
        if (b.x < gameState.cameraX - 500 || b.y < gameState.cameraY - 500) { flock.splice(i, 1); }
    }
    player.grounded = false; checkCollisions(); checkDeath();
    player.trails.push({ x: player.x, y: player.y }); if (player.trails.length > 8) player.trails.shift();
    gameState.distance = Math.floor(player.x / 10); document.getElementById('score').innerText = gameState.distance + "m";
    updateBillboards(dt);
}

function updateFall(dt) {
    player.x += player.vx * dt; player.y += player.vy * dt; player.vy += CONFIG.gravity * dt;
    if (input.active && !player.grounded) { player.vx += 0.05 * dt; }
    if (player.vy > CONFIG.maxFallSpeed) player.vy = CONFIG.maxFallSpeed;
    player.vx *= (1 - (1 - CONFIG.airFriction) * dt);
}

function updateSwing(dt) {
    if (!player.anchor) { player.state = 'falling'; return; }
    let dx = player.x - player.anchor.x; let dy = player.y - player.anchor.y; let dist = Math.sqrt(dx * dx + dy * dy);
    let nx = dx / dist; let ny = dy / dist;
    let tx = -ny; let ty = nx;
    let dot = player.vx * tx + player.vy * ty; if (dot < 0) { tx = -tx; ty = -ty; }
    player.vy += CONFIG.gravity * dt;
    if (input.active) { let pump = 0.2 * dt; player.vx += tx * pump; player.vy += ty * pump; }
    player.x += player.vx * dt; player.y += player.vy * dt;
    let ndx = player.x - player.anchor.x; let ndy = player.y - player.anchor.y; let newDist = Math.sqrt(ndx * ndx + ndy * ndy);
    if (newDist > player.ropeLength) {
        let overshoot = newDist - player.ropeLength;
        if (player.grounded) { let pullX = (ndx / newDist) * overshoot * 0.5; player.vx -= pullX; }
        else { player.x -= (ndx / newDist) * overshoot * CONFIG.swingElasticity; player.y -= (ndy / newDist) * overshoot * CONFIG.swingElasticity; }
        let nndx = player.x - player.anchor.x; let nndy = player.y - player.anchor.y; let nDist = Math.sqrt(nndx * nndx + nndy * nndy);
        let ntx = -nndy / nDist; let nty = nndx / nDist;
        let velDot = player.vx * ntx + player.vy * nty; player.vx = ntx * velDot; player.vy = nty * velDot;
        if (player.grounded && input.active) { player.vx += 0.2 * dt; }
    }
    player.vx *= 0.999; player.vy *= 0.999;
}

function tryAttachWeb() {
    let best = null; let bestDist = Infinity;
    for (let a of anchors) {
        let dx = a.x - player.x; let dy = a.y - player.y; let d = Math.sqrt(dx * dx + dy * dy);
        if (d >= CONFIG.webLengthMin && d <= CONFIG.webLengthMax) {
            let score = d; if (dx < 0) score += 500; if (dy > 0) score += 200;
            if (a.type === 'crane') score -= 50;
            if (score < bestDist) { bestDist = score; best = a; }
        }
    }
    if (best) { player.anchor = best; player.state = 'swinging'; let dx = player.x - best.x; let dy = player.y - best.y; player.ropeLength = Math.sqrt(dx * dx + dy * dy); player.hasSwung = true; playSound(sounds.thwip); }
}

function releaseWeb() {
    player.state = 'falling';
    if (player.anchor) { let speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy); if (speed > 10) gameState.shake = speed * 0.5; player.vx *= CONFIG.swingBoost; player.vy *= CONFIG.swingBoost; }
    player.anchor = null; player.hasSwung = true; stopSound(sounds.thwip);
}

function checkCollisions() {
    for (let b of buildings) {
        if (player.x + player.radius >= b.x && player.x - player.radius <= b.x + b.width && player.y + player.radius >= b.y && player.y - player.radius <= b.y + b.height) {
            let overlapY = (player.y + player.radius) - b.y;
            if (player.vy >= 0 && overlapY <= 30 && overlapY > -50) { player.y = b.y - player.radius; player.vy = 0; player.grounded = true; if (player.state === 'swinging') releaseWeb(); player.vx *= CONFIG.groundFriction; if (player.vx < 6) player.vx = 6; if (player.vx > 12) player.vx = 12; }
            else { gameOver(); }
        }
    }
}

function checkDeath() { if (player.y > gameState.height + 150) gameOver(); }

function gameOver() { gameState.running = false; document.getElementById('final-score').innerText = "Distance: " + gameState.distance + "m"; document.getElementById('game-over').style.display = 'block'; }

function generateWorld() {
    let genX = gameState.cameraX + gameState.width * 2;
    let lastX = -200; if (buildings.length > 0) lastX = buildings[buildings.length - 1].x + buildings[buildings.length - 1].width;
    let lastAnchorX = 200; if (anchors.length > 0) lastAnchorX = anchors[anchors.length - 1].x;
    if (lastX < genX) {
        let gap = random(150, 500); let w = random(250, 700); let y = gameState.height - random(100, 400); if (Math.random() > 0.7) y += random(50, 150);
        buildings.push({ x: lastX + gap, y: y, width: w, height: 2000, type: 'building', color: `hsl(${200 + Math.random() * 40}, ${5 + Math.random() * 15}%, ${10 + Math.random() * 15}%)`, windowSeed: Math.random(), hasNeon: Math.random() > 0.8, neonColor: `hsl(${Math.random() * 360}, 100%, 60%)`, hasTier: Math.random() > 0.5, tierWidth: w * 0.7, tierHeight: 150, hasAd: false });
        attachAdToBuilding(buildings[buildings.length - 1]);
    }
    if (lastAnchorX < genX) {
        let gap = random(250, 450); let y = random(100, 350);
        anchors.push({ x: lastAnchorX + gap, y: y, type: Math.random() > 0.7 ? 'crane' : 'normal' });
    }
}

function cleanupWorld() {
    let limit = gameState.cameraX - 500;
    for (let b of buildings) { if (b.x + b.width < limit && b.adElement) { if (b.adLoaded) activeAdCount--; b.adElement.remove(); b.adElement = null; } }
    buildings = buildings.filter(b => b.x + b.width > limit);
    anchors = anchors.filter(a => a.x > limit);
}

function attachAdToBuilding(b) {
    if (b.hasAd) return; b.hasAd = true; b.adLoaded = false;
    const template = AD_TEMPLATES[Math.floor(Math.random() * AD_TEMPLATES.length)];
    b.adConfig = template; b.adIsTop = Math.random() > 0.4;
    b.adWidth = template.width; b.adHeight = template.height;
    if (b.adIsTop) { b.adRelX = random(0, Math.max(1, b.width - b.adWidth)); b.adRelY = -b.adHeight - 45; }
    else { b.adRelX = (b.width > b.adWidth) ? random(10, b.width - b.adWidth - 10) : (b.width - b.adWidth)/2; b.adRelY = random(10, 80); }
    const adEl = document.createElement('div'); adEl.className = 'billboard-ad' + (b.adIsTop ? ' on-top' : '');
    adEl.style.width = b.adWidth + 'px'; adEl.style.height = b.adHeight + 'px'; adEl.innerHTML = `<div class="ad-placeholder">CONNECTING...</div>`;
    document.getElementById('ad-layer').appendChild(adEl); b.adElement = adEl;
}

function injectAdScript(b) {
    if (!b.adElement || b.adLoaded || activeAdCount >= AD_SETTINGS.maxActiveAds) return;
    b.adLoaded = true; activeAdCount++; b.adElement.innerHTML = '';
    const config = b.adConfig;
    const script1 = document.createElement('script'); script1.type = 'text/javascript';
    script1.innerHTML = `atOptions = { 'key' : '${config.key}', 'format' : 'iframe', 'height' : ${config.height}, 'width' : ${config.width}, 'params' : {} };`;
    b.adElement.appendChild(script1);
    const script2 = document.createElement('script'); script2.type = 'text/javascript';
    script2.src = `https://www.highperformanceformat.com/${config.key}/invoke.js`;
    b.adElement.appendChild(script2);
}

function updateBillboards(dt = 1) {
    adLoadTimer += dt * 16.66;
    if (adLoadTimer > AD_SETTINGS.loadInterval) {
        adLoadTimer = 0; let bestCandidate = null; let maxX = -Infinity;
        for (let b of buildings) { if (b.hasAd && !b.adLoaded) { let screenX = b.x - gameState.cameraX; if (screenX > -100 && screenX < gameState.width + 200 && screenX > maxX) { maxX = screenX; bestCandidate = b; } } }
        if (bestCandidate) injectAdScript(bestCandidate);
    }
    for (let b of buildings) { if (b.hasAd && b.adElement) { let screenX = b.x + b.adRelX - gameState.cameraX; let screenY = b.y + b.adRelY - gameState.cameraY; if (screenX + b.adWidth < -300 || screenX > gameState.width + 300) { b.adElement.style.display = 'none'; } else { b.adElement.style.display = 'flex'; b.adElement.style.transform = `translate(${screenX}px, ${screenY}px)`; } } }
}

function drawCrane(ctx, anchorX, anchorY, isAligned) {
    const towerX = anchorX - 250; const towerTopY = anchorY - 120;
    ctx.save(); ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(towerX - 10, gameState.height + 1000); ctx.lineTo(towerX - 10, towerTopY); ctx.moveTo(towerX + 10, gameState.height + 1000); ctx.lineTo(towerX + 10, towerTopY); ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(towerX - 18, towerTopY - 45, 36, 45);
    ctx.save(); ctx.translate(towerX, towerTopY - 20); ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-120, -15); ctx.lineTo(500, -10); ctx.moveTo(-120, 15); ctx.lineTo(500, 10); ctx.stroke();
    let trolleyX = anchorX - towerX; ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(trolleyX, 15); ctx.lineTo(trolleyX, anchorY - (towerTopY - 20)); ctx.stroke(); ctx.restore(); ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    ctx.fillStyle = '#050508'; ctx.fillRect(0, 0, gameState.width, gameState.height);
    ctx.save(); ctx.translate(-gameState.cameraX, -gameState.cameraY);
    for (let a of anchors) { if (a.type === 'crane') drawCrane(ctx, a.x, a.y, a.alignment === 'aligned'); }
    for (let b of buildings) { ctx.fillStyle = b.color || '#1a1a1a'; ctx.fillRect(b.x, b.y, b.width, b.height); }
    if (sprites.bird.loaded) {
        let frameW = sprites.bird.img.width / sprites.bird.cols; let frameH = sprites.bird.img.height / sprites.bird.rows;
        for (let b of flock) { ctx.save(); ctx.translate(b.x, b.y); if (b.facingLeft) ctx.scale(-1, 1); let col = b.frame % sprites.bird.cols; let row = Math.floor(b.frame / sprites.bird.cols); ctx.drawImage(sprites.bird.img, col * frameW, row * frameH, frameW, frameH, -16, -32, 32, 32); ctx.restore(); }
    }
    ctx.restore();
    fgCtx.save(); fgCtx.translate(-gameState.cameraX, -gameState.cameraY);
    if (player.state === 'swinging' && player.anchor) { fgCtx.strokeStyle = '#fff'; fgCtx.lineWidth = 3; fgCtx.beginPath(); fgCtx.moveTo(player.x, player.y); fgCtx.lineTo(player.anchor.x, player.anchor.y); fgCtx.stroke(); }
    drawPlayerOnCtx(fgCtx); fgCtx.restore();
    if (isMobile) drawMobileHUD();
}

function drawPlayerOnCtx(targetCtx) {
    targetCtx.save(); targetCtx.translate(player.x, player.y);
    let speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    let currentSprite = player.state === 'swinging' ? sprites.swing : (player.grounded ? sprites.run : sprites.swing);
    if (currentSprite && currentSprite.loaded) {
        let frameWidth = currentSprite.img.width / currentSprite.cols; let frameHeight = currentSprite.img.height / currentSprite.rows;
        let frameIndex = Math.floor(player.animTimer * (player.grounded ? speed * 0.4 : 8)) % currentSprite.totalFrames;
        let col = frameIndex % currentSprite.cols; let row = Math.floor(frameIndex / currentSprite.cols);
        targetCtx.drawImage(currentSprite.img, col * frameWidth, row * frameHeight, frameWidth, frameHeight, -32, -32, 64, 64);
    } else { targetCtx.fillStyle = '#ff00ff'; targetCtx.beginPath(); targetCtx.arc(0, 0, player.radius, 0, Math.PI * 2); targetCtx.fill(); }
    targetCtx.restore();
}

function drawMobileHUD() {
    let showClimb = player.state === 'swinging'; let btnSize = touchState.btnSize;
    let upX = touchState.btnUpX; let upY = touchState.btnUpY;
    fgCtx.save(); fgCtx.globalAlpha = showClimb ? (touchState.climbUpActive ? 0.8 : 0.35) : 0.1; fgCtx.fillStyle = 'rgba(255, 255, 255, 0.2)'; fgCtx.fillRect(upX, upY, btnSize, btnSize); fgCtx.restore();
    let downX = touchState.btnDownX; let downY = touchState.btnDownY;
    fgCtx.save(); fgCtx.globalAlpha = showClimb ? (touchState.climbDownActive ? 0.8 : 0.35) : 0.1; fgCtx.fillStyle = 'rgba(255, 255, 255, 0.2)'; fgCtx.fillRect(downX, downY, btnSize, btnSize); fgCtx.restore();
}

function random(min, max) { return Math.random() * (max - min) + min; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

init();
