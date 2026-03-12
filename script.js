const { Engine, Render, World, Bodies, Body, Events, Composite, Vector, Detector, Common } = Matter;

// Configuration
const GAME_SIZE = 460;
const CENTER = { x: GAME_SIZE / 2, y: GAME_SIZE / 2 };
const BOWL_RADIUS = 160;
const ORBIT_RADIUS = 200;
const GAMEOVER_RADIUS = 175;
const WARNING_TRIGGER_RADIUS = 155;
const WARNING_LINE_RADIUS = 160;

const BALL_RADII = [12.5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65];
const BALL_COLORS = [
    '#FF3333', '#FF9933', '#FFFF33', '#33FF33', '#33FFFF',
    '#3333FF', '#9933FF', '#FF33FF', '#FFFFFF', '#000000',
    '#FF5733', '#33FF57'
];

const USE_IMAGES = true;

// Performance Loop Variables
let engine;
let render;
let lastTime = 0;
let accumulator = 0;
const fixedTimeStep = 1000 / 60; // 16.67ms
const maxUpdates = 2; // Circuit Breaker

// Game State
let score = 0;
let isGameOver = false;
let isPlaying = false;
let isPaused = false;
let isWarningActive = false;
let currentSpeedLevel = 0;
let upcomingLevels = [];
let previewBall = null;
let orbitAngle = 0;
let orbitSpeed = 0.02;
let lastShotBodyId = null;

// Input Cooldown (Frame-based)
let spawnCooldownFrames = 0;
const SPAWN_COOLDOWN_LIMIT = 30; // ~0.5s at 60fps

// Elements
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const gameHeader = document.getElementById('game-header');
const gameFooter = document.getElementById('game-footer');
const retryBtn = document.getElementById('retry-btn');
const retryBtnTop = document.getElementById('retry-btn-top');
const shareBtn = document.getElementById('share-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const uiLayer = document.getElementById('ui-layer');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const bgmSlider = document.getElementById('bgm-volume');
const sfxSlider = document.getElementById('sfx-volume');
const loadingScreen = document.getElementById('loading-screen');
const loadingProgress = document.getElementById('loading-progress');

// Asset Cache
const ASSET_IMAGES = {};
const IMAGES_TO_LOAD = Array.from({ length: 12 }, (_, i) => `assets/${String(i + 1).padStart(3, '0')}.PNG`);

// Audio
let audioCtx, bgmGain, sfxGain;
const sfxBuffers = {};
const bgm = new Audio('assets/bgm.mp3');
bgm.loop = true;
let bgmVolume = 0.5;
let sfxVolume = 1.0;

// Object Pooling
const ballPool = [];
function getBallFromBody(body) { return body.gameEntity; }

class BallEntity {
    constructor() {
        this.isActive = false;
        this.body = Bodies.circle(0, 0, 10, {
            restitution: 0.2, // Lower bounce for stability
            friction: 0.3,    // High friction to "lock" groups together
            frictionAir: 0.03,
            slop: 0.1,        // Higher slop reduces jitter
            render: { visible: false }
        });
        this.body.gameEntity = this;
        this.level = 0;
        this.isPopping = false;
        this.popScale = 1;
        this.assetImg = null;
    }

    init(x, y, level) {
        this.isActive = true;
        this.level = level;
        this.isPopping = false;
        this.popScale = 1;
        this.body.id = Common.nextId();
        this.body.level = level;
        this.assetImg = ASSET_IMAGES[String(level + 1).padStart(3, '0')];

        const radius = BALL_RADII[level];
        const scaleFactor = radius / this.body.circleRadius;

        Body.setPosition(this.body, { x, y });
        Body.setVelocity(this.body, { x: 0, y: 0 });
        Body.setAngularVelocity(this.body, 0);
        Body.scale(this.body, scaleFactor, scaleFactor);

        this.body.collisionFilter.mask = 0xFFFFFFFF;
        this.body.collisionFilter.category = 0x0001;

        World.add(engine.world, this.body);
    }

    deactivate() {
        if (!this.isActive) return;
        this.isActive = false;
        World.remove(engine.world, this.body);
    }
}

// Pool Management
function spawnFromPool(x, y, level) {
    let entity = ballPool.find(e => !e.isActive);
    if (!entity) {
        entity = new BallEntity();
        ballPool.push(entity);
    }
    entity.init(x, y, level);
    return entity;
}

async function preloadAssets() {
    let loadedCount = 0;
    const SFX_TO_LOAD = [
        { name: 'click', src: 'assets/click.mp3' },
        { name: 'merge', src: 'assets/merge.mp3' }
    ];
    const totalAssets = IMAGES_TO_LOAD.length + SFX_TO_LOAD.length;

    const updateProgress = () => {
        loadedCount++;
        const percent = Math.floor((loadedCount / totalAssets) * 100);
        if (loadingProgress) loadingProgress.textContent = percent + '%';
        if (loadedCount >= totalAssets) {
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                init();
            }, 500);
        }
    };

    IMAGES_TO_LOAD.forEach(src => {
        const img = new Image();
        img.onload = () => {
            const key = src.split('/').pop().split('.')[0];
            ASSET_IMAGES[key] = img;
            updateProgress();
        };
        img.onerror = updateProgress;
        img.src = src;
    });

    for (const sfx of SFX_TO_LOAD) {
        try {
            const response = await fetch(sfx.src);
            sfxBuffers[sfx.name] = await response.arrayBuffer();
            updateProgress();
        } catch (e) {
            updateProgress();
        }
    }
}

function init() {
    engine = Engine.create({
        positionIterations: 10,
        velocityIterations: 4,
        enableSleeping: false // Disable sleeping for better late-game collective stability
    });
    engine.world.gravity.y = 0;

    render = Render.create({
        element: document.getElementById('game-container'),
        engine: engine,
        options: {
            width: GAME_SIZE,
            height: GAME_SIZE,
            wireframes: false,
            background: 'transparent',
            pixelRatio: Math.min(window.devicePixelRatio, 2)
        }
    });

    // Start Custom Loop
    requestAnimationFrame(gameLoop);

    showStartMessage();
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');

    // Rendering Layer
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        drawEnvironment(ctx);
        drawPreview(ctx);
        drawActiveBalls(ctx);
    });

    // Collision Detection
    Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; i++) {
            const bodyA = pairs[i].bodyA;
            const bodyB = pairs[i].bodyB;
            if (bodyA.level !== undefined && bodyB.level !== undefined) {
                if (bodyA.level === bodyB.level && bodyA.level < 11) {
                    mergeBalls(bodyA, bodyB);
                }
            }
        }
    });

    const canvas = render.canvas;
    canvas.style.touchAction = 'none'; // Optimization 3: Input Resilience
    window.addEventListener('pointerdown', handleInput);

    spawnPreview();
}

// Optimization 1: Custom High-Performance Loop
function gameLoop(time) {
    if (lastTime === 0) lastTime = time;
    const deltaTime = time - lastTime;
    lastTime = time;

    if (!isPaused) {
        accumulator += deltaTime;
        let updates = 0;

        // Fixed physics step
        while (accumulator >= fixedTimeStep && updates < maxUpdates) {
            updatePhysics();
            accumulator -= fixedTimeStep;
            updates++;
        }

        // Overflow protection: if updates hits maxUpdates, 
        // we drop the extra time to keep UI responsive (Circuit Breaker)
        if (updates >= maxUpdates) accumulator = 0;
    }

    // Rendering always runs if not paused or specifically required
    Render.world(render);
    requestAnimationFrame(gameLoop);
}

function updatePhysics() {
    if (isGameOver || !isPlaying) return;

    // Cooldown
    if (spawnCooldownFrames > 0) spawnCooldownFrames--;

    // Orbit
    orbitAngle -= orbitSpeed;
    if (previewBall) {
        previewBall.x = CENTER.x + Math.cos(orbitAngle) * ORBIT_RADIUS;
        previewBall.y = CENTER.y + Math.sin(orbitAngle) * ORBIT_RADIUS;
    }

    const bodies = Composite.allBodies(engine.world);
    let warningTriggered = false;

    for (const body of bodies) {
        if (body.isStatic) continue;

        const dx = CENTER.x - body.position.x;
        const dy = CENTER.y - body.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Simplified Stable Gravity (Fix: No complex falloff to avoid Late-game jitter)
        if (distance > 4) {
            const levelBoost = 1 + (currentSpeedLevel * 0.06);
            const forceMag = 0.0016 * body.mass * levelBoost;
            const unitForce = forceMag / distance;
            Body.applyForce(body, body.position, { x: dx * unitForce, y: dy * unitForce });
        }

        // Global Damping (Fix: Simple reliable energy drain)
        if (body.speed < 1.0) {
            Body.setVelocity(body, { x: body.velocity.x * 0.94, y: body.velocity.y * 0.94 });
            if (body.speed < 0.1) {
                Body.setVelocity(body, { x: 0, y: 0 });
                Body.setAngularVelocity(body, 0);
            }
        }

        // Boundary Check
        const edgeDist = distance + body.circleRadius;
        if (edgeDist > WARNING_TRIGGER_RADIUS) {
            if (body.id !== lastShotBodyId || body.speed < 2) warningTriggered = true;
        }

        if (edgeDist > GAMEOVER_RADIUS && body.speed < 0.2 && body.id !== lastShotBodyId) {
            endGame();
        }

        // Pop Logic (Visual only)
        const entity = getBallFromBody(body);
        if (entity && entity.isPopping) {
            entity.popScale *= 0.92;
            if (entity.popScale < 1.05) {
                entity.isPopping = false;
                entity.popScale = 1;
            }
        }
    }

    isWarningActive = warningTriggered;
    Engine.update(engine, fixedTimeStep);
}

function drawEnvironment(ctx) {
    // Bowl
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, BOWL_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Orbit
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ORBIT_RADIUS, 0, 2 * Math.PI);
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.setLineDash([]);

    // Warning
    if (isWarningActive && !isGameOver) {
        ctx.beginPath();
        ctx.arc(CENTER.x, CENTER.y, WARNING_LINE_RADIUS, 0, 2 * Math.PI);
        ctx.setLineDash([15, 15]);
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawPreview(ctx) {
    if (!previewBall || !isPlaying) return;
    const key = String(previewBall.level + 1).padStart(3, '0');
    const img = ASSET_IMAGES[key];
    const r = previewBall.radius;
    if (img) {
        ctx.drawImage(img, previewBall.x - r, previewBall.y - r, r * 2, r * 2);
    } else {
        ctx.beginPath();
        ctx.arc(previewBall.x, previewBall.y, r, 0, Math.PI * 2);
        ctx.fillStyle = previewBall.color;
        ctx.fill();
    }
}

function drawActiveBalls(ctx) {
    for (const entity of ballPool) {
        if (!entity.isActive) continue;
        const b = entity.body;
        const r = BALL_RADII[entity.level] * entity.popScale;

        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        if (entity.assetImg) {
            ctx.drawImage(entity.assetImg, -r, -r, r * 2, r * 2);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fillStyle = BALL_COLORS[entity.level];
            ctx.fill();
        }
        ctx.restore();
    }
}

function handleInput(e) {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('.modal-content')) return;
    if (isGameOver || isPaused) return;

    // Audio Unlock (Immediate Synchronous Logic to preserve gesture)
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            bgmGain = audioCtx.createGain();
            sfxGain = audioCtx.createGain();
            bgmGain.connect(audioCtx.destination);
            sfxGain.connect(audioCtx.destination);
            bgmGain.gain.value = bgmVolume;
            sfxGain.gain.value = sfxVolume;

            const source = audioCtx.createMediaElementSource(bgm);
            source.connect(bgmGain);

            // Background decode without blocking
            Object.keys(sfxBuffers).forEach(async name => {
                if (sfxBuffers[name] instanceof ArrayBuffer) {
                    const data = sfxBuffers[name];
                    sfxBuffers[name] = await audioCtx.decodeAudioData(data);
                }
            });
        } catch (err) { console.warn(err); }
    }
    if (audioCtx?.state === 'suspended') audioCtx.resume();

    if (!isPlaying) {
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';
        updateNextPreviewUI();
        if (bgmVolume > 0) bgm.play().catch(() => { });
    }

    shoot();
}

function spawnPreview() {
    // Ensure we have at least 2 levels in the queue (one for current orbiter, one for next preview)
    while (upcomingLevels.length < 2) {
        upcomingLevels.push(Math.floor(Math.random() * 4));
    }

    const level = upcomingLevels.shift();

    previewBall = {
        level: level,
        radius: BALL_RADII[level],
        color: BALL_COLORS[level],
        x: CENTER.x + ORBIT_RADIUS,
        y: CENTER.y
    };

    updateNextPreviewUI();
}

function shoot() {
    if (!previewBall || isGameOver || spawnCooldownFrames > 0) return;

    const entity = spawnFromPool(previewBall.x, previewBall.y, previewBall.level);
    lastShotBodyId = entity.body.id;

    const dx = CENTER.x - previewBall.x;
    const dy = CENTER.y - previewBall.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 6;

    Body.setVelocity(entity.body, { x: (dx / dist) * speed, y: (dy / dist) * speed });

    playSound('click');
    previewBall = null;
    spawnCooldownFrames = SPAWN_COOLDOWN_LIMIT;
    setTimeout(spawnPreview, 500); // UI delay for preview
}

function mergeBalls(bodyA, bodyB) {
    const entA = getBallFromBody(bodyA);
    const entB = getBallFromBody(bodyB);
    if (!entA || !entB || !entA.isActive || !entB.isActive) return;

    const midX = (bodyA.position.x + bodyB.position.x) / 2;
    const midY = (bodyA.position.y + bodyB.position.y) / 2;
    const newLevel = bodyA.level + 1;

    entA.deactivate();
    entB.deactivate();

    score += (newLevel + 1) * 10;
    scoreEl.textContent = score;
    checkLevelUp(score);
    playSound('merge');

    const newEnt = spawnFromPool(midX, midY, newLevel);

    // Soften big ball merges to prevent "explosive" popping in crowded bowl
    if (newLevel > 8) {
        newEnt.body.restitution = 0.1;
        setTimeout(() => { if (newEnt.isActive) newEnt.body.restitution = 0.3; }, 200);
    }

    newEnt.popScale = 1.3;
    newEnt.isPopping = true;

    Body.setVelocity(newEnt.body, { x: (Math.random() - 0.5), y: (Math.random() - 0.5) });
}

function updateNextPreviewUI() {
    const slot1 = document.getElementById('next-ball-1');
    const container = document.getElementById('next-preview-container');
    if (!slot1 || !container) return;

    if (!isPlaying) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    // Always show the next ball in the queue (index 0 of upcomingLevels)
    const lvl = (upcomingLevels && upcomingLevels.length > 0) ? upcomingLevels[0] : 0;

    if (USE_IMAGES) {
        const imagePath = `assets/${String(lvl + 1).padStart(3, '0')}.PNG`;
        slot1.style.backgroundImage = `url("${imagePath}")`;
        slot1.style.backgroundColor = 'transparent';
    } else {
        slot1.style.backgroundImage = 'none';
        slot1.style.backgroundColor = BALL_COLORS[lvl] || '#fff';
    }
}

function checkLevelUp(currentScore) {
    if (currentScore < 2000) return;
    let newLevel = Math.min(1 + Math.floor((currentScore - 2000) / 1500), 10);
    if (newLevel > currentSpeedLevel) {
        currentSpeedLevel = newLevel;
        orbitSpeed = 0.02 * (1 + 0.12 * currentSpeedLevel);
        showLevelUpText();
    }
}

function showLevelUpText() {
    const container = document.getElementById('ui-layer');
    const msg = document.createElement('div');
    msg.className = 'level-up-container level-up-anim';
    msg.innerHTML = '<span class="arrow">↑</span><span>level up</span><span class="arrow">↑</span>';
    container.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    finalScoreEl.textContent = score;
    gameHeader.classList.remove('hidden');
    gameFooter.classList.remove('hidden');
    uiLayer.classList.add('hidden');
}

function resetGame() {
    ballPool.forEach(e => e.deactivate());
    score = 0;
    scoreEl.textContent = '0';
    currentSpeedLevel = 0;
    orbitSpeed = 0.02;
    isGameOver = false;
    upcomingLevels = [];
    previewBall = null;
    isPlaying = false;
    spawnCooldownFrames = 0;

    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    showStartMessage();
    spawnPreview();
}

function playSound(name) {
    if (sfxVolume > 0 && sfxBuffers[name] instanceof AudioBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = sfxBuffers[name];
        source.connect(sfxGain);
        source.start(0);
    }
}

function showStartMessage() {
    const old = document.getElementById('start-message');
    if (old) old.remove();
    const msg = document.createElement('div');
    msg.id = 'start-message';
    msg.innerHTML = "<h1>Tap Anywhere<br>to Start</h1>";
    Object.assign(msg.style, {
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center', width: '100%', color: 'white', fontSize: '30px',
        pointerEvents: 'none', textShadow: '0 0 10px black', zIndex: '5'
    });
    document.getElementById('game-container').appendChild(msg);
}

// Global UI Handlers
retryBtnTop?.addEventListener('click', resetGame);
retryBtn?.addEventListener('click', resetGame);
settingsBtn?.addEventListener('click', () => { 
    settingsModal.classList.remove('hidden'); 
    settingsModal.style.display = 'flex'; 
    isPaused = true;
});
closeSettingsBtn?.addEventListener('click', () => { 
    settingsModal.classList.add('hidden'); 
    settingsModal.style.display = 'none'; 
    isPaused = false;
    lastTime = performance.now(); // Reset lastTime to avoid jump in physics
});

bgmSlider.addEventListener('input', (e) => {
    bgmVolume = e.target.value / 100;
    if (bgmGain) bgmGain.gain.setTargetAtTime(bgmVolume, audioCtx.currentTime, 0.05);
});

sfxSlider.addEventListener('input', (e) => {
    sfxVolume = e.target.value / 100;
    if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume, audioCtx.currentTime, 0.05);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        bgm.pause();
        isPaused = true;
    } else {
        if (isPlaying && bgmVolume > 0) bgm.play();
        isPaused = false;
        lastTime = performance.now();
    }
});

if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        const gameCanvas = document.querySelector('#game-container canvas');
        if (!gameCanvas) return;
        const captureCanvas = document.createElement('canvas');
        const headerHeight = 120, footerHeight = 60;
        const ratio = gameCanvas.width / GAME_SIZE;
        captureCanvas.width = gameCanvas.width;
        captureCanvas.height = (GAME_SIZE + headerHeight + footerHeight) * ratio;
        const ctx = captureCanvas.getContext('2d');
        ctx.fillStyle = '#251e36';
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
        const centerX = captureCanvas.width / 2;
        ctx.fillStyle = '#ff4444';
        ctx.font = `bold ${48 * ratio}px Arial`;
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2 * ratio;
        ctx.strokeText('Game Over', centerX, 60 * ratio);
        ctx.fillText('Game Over', centerX, 60 * ratio);
        ctx.fillStyle = 'white';
        ctx.font = `bold ${36 * ratio}px Arial`;
        ctx.fillText('Score: ' + score, centerX, 105 * ratio);
        ctx.drawImage(gameCanvas, 0, headerHeight * ratio);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = `${14 * ratio}px Arial`;
        ctx.fillText('Nika © nikaworx.com', centerX, captureCanvas.height - (20 * ratio));

        const filename = `Fuwavity_Score_${score}.png`;

        // Check if device is truly capable of sharing files (mostly mobile only)
        const canShareFiles = navigator.canShare && navigator.canShare({
            files: [new File([], 't.png', { type: 'image/png' })]
        });

        if (canShareFiles && captureCanvas.toBlob) {
            captureCanvas.toBlob(blob => {
                try {
                    const file = new File([blob], filename, { type: 'image/png' });
                    navigator.share({
                        files: [file],
                        title: 'Fuwavity Score',
                        text: `I scored ${score} in Fuwavity!`
                    }).catch(() => downloadImage(captureCanvas, filename));
                } catch (e) {
                    downloadImage(captureCanvas, filename);
                }
            });
        } else {
            // Standard desktop/older browser download
            try {
                downloadImage(captureCanvas, filename);
            } catch (e) {
                console.error("Save image failed: Canvas might be tainted. Use a local server.", e);
                alert("Please use a local server (like Live Server) to enable screenshot saving.");
            }
        }
    });
}

function downloadImage(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        const url = "https://nikaworx.com/Fuwavity/";
        const msg = `I scored ${score} in Fuwavity!`;
        if (navigator.share) navigator.share({ title: 'Fuwavity', text: msg, url });
        else { navigator.clipboard.writeText(`${msg} ${url}`); alert('Copied!'); }
    });
}

preloadAssets();

