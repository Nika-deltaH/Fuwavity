const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Vector, Detector } = Matter;

// Configuration
const GAME_SIZE = 460; // Canvas size (Internal logical size)
const CENTER = { x: GAME_SIZE / 2, y: GAME_SIZE / 2 };
const BOWL_RADIUS = 160; // 320px diameter 
const ORBIT_RADIUS = 200; // 400px diameter 
const GAMEOVER_RADIUS = 175; // 360px diameter
const WARNING_TRIGGER_RADIUS = 155; // 310px diameter
const WARNING_LINE_RADIUS = 160; // 320px diameter

// Sizes: 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130 (Diameters)
// Radii: 12.5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65
const BALL_RADII = [12.5, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65];

// Placeholder Colors
const BALL_COLORS = [
    '#FF3333', '#FF9933', '#FFFF33', '#33FF33', '#33FFFF',
    '#3333FF', '#9933FF', '#FF33FF', '#FFFFFF', '#000000',
    '#FF5733', '#33FF57'
];

// --- IMAGE REPLACEMENT CONFIGURATION ---
// To use images:
// 1. Put images named 001.PNG... 012.PNG in the 'assets' folder.
// 2. Set USE_IMAGES = true;
const USE_IMAGES = true;
// ---------------------------------------

let engine;
let render;
let runner;
let score = 0;
let isGameOver = false;
let isPlaying = false;
let isWarningActive = false;

let currentSpeedLevel = 0;

// Upcoming queue
let upcomingLevels = [];

// The ball currently orbiting and waiting to be dropped
let previewBall = null;
let spawnTimeoutId = null;
let orbitAngle = 0;
let orbitSpeed = 0.02;

// Elements
const scoreEl = document.getElementById('score'); // Live Score
const finalScoreEl = document.getElementById('final-score');
const gameHeader = document.getElementById('game-header');
const gameFooter = document.getElementById('game-footer');
const retryBtn = document.getElementById('retry-btn');
const retryBtnTop = document.getElementById('retry-btn-top');
const shareBtn = document.getElementById('share-btn');
const screenshotBtn = document.getElementById('screenshot-btn');
const mainWrapper = document.getElementById('main-wrapper');
const uiLayer = document.getElementById('ui-layer'); // In-Game UI
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const bgmSlider = document.getElementById('bgm-volume');
const sfxSlider = document.getElementById('sfx-volume');
const loadingScreen = document.getElementById('loading-screen');
const loadingProgress = document.getElementById('loading-progress');

// Audio
const bgm = new Audio('assets/bgm.mp3');
bgm.loop = true;
const clickSound = new Audio('assets/click.mp3');
const mergeSound = new Audio('assets/merge.mp3');

// Asset Lists
const IMAGES_TO_LOAD = [
    'assets/001.PNG', 'assets/002.PNG', 'assets/003.PNG', 'assets/004.PNG',
    'assets/005.PNG', 'assets/006.PNG', 'assets/007.PNG', 'assets/008.PNG',
    'assets/009.PNG', 'assets/010.PNG', 'assets/011.PNG', 'assets/012.PNG'
];
const ASSET_IMAGES = {}; // Cache for preloaded images

// Audio Init Volume
let bgmVolume = 0.5;
let sfxVolume = 1.0;

bgm.volume = bgmVolume;
clickSound.volume = sfxVolume;
mergeSound.volume = sfxVolume;

async function preloadAssets() {
    let loadedCount = 0;
    const totalAssets = IMAGES_TO_LOAD.length; // Intentionally only tracking images for visual loading bar
    // Audio preloading is less visual, but we can try to fetch them too.

    const updateProgress = () => {
        loadedCount++;
        const percent = Math.floor((loadedCount / totalAssets) * 100);
        if (loadingProgress) loadingProgress.textContent = percent + '%';
        if (loadedCount >= totalAssets) {
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                init();
            }, 500); // Small delay for smoothness
        }
    };

    IMAGES_TO_LOAD.forEach(src => {
        const img = new Image();
        img.onload = () => {
            // Extract simple filename key (e.g., '001')
            const key = src.split('/').pop().split('.')[0];
            ASSET_IMAGES[key] = img;
            updateProgress();
        };
        img.onerror = (e) => {
            console.error('Failed to load image:', src, e);
            updateProgress(); // Continue anyway to avoid hanging
        };
        img.src = src;
    });
}

function init() {
    // Create Engine
    engine = Engine.create({
        positionIterations: 6, // Optimization: Balanced accuracy (default 6)
        velocityIterations: 4  // Optimization: Balanced stability (default 4)
    });
    engine.world.gravity.y = 0;

    // Create Renderer
    render = Render.create({
        element: document.getElementById('game-container'),
        engine: engine,
        options: {
            width: GAME_SIZE,
            height: GAME_SIZE,
            wireframes: false,
            background: 'transparent',
            // IMPORTANT: For images to look good when scaled
            // Optimization: Cap pixelRatio at 2 to prevent massive GPU load on phones (3x/4x screens)
            pixelRatio: Math.min(window.devicePixelRatio, 2)
        }
    });

    // Create Runner
    runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    // Initial message
    showStartMessage();

    // Ensure Init State: Header/Footer hidden, UI shown (but msg covers it)
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');

    // Custom Rendering for Bowl and Orbit
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;

        // Draw Bowl Background
        ctx.beginPath();
        ctx.arc(CENTER.x, CENTER.y, BOWL_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw Orbit
        ctx.beginPath();
        ctx.arc(CENTER.x, CENTER.y, ORBIT_RADIUS, 0, 2 * Math.PI);
        ctx.setLineDash([10, 10]);
        ctx.setLineDash([10, 10]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Warning Line
        if (isWarningActive && !isGameOver) {
            ctx.beginPath();
            ctx.arc(CENTER.x, CENTER.y, WARNING_LINE_RADIUS, 0, 2 * Math.PI);
            ctx.setLineDash([15, 15]);
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw Preview Ball
        if (previewBall && isPlaying) {
            if (USE_IMAGES) {
                // Image Rendering using Cached Object
                const imageIndex = String(previewBall.level + 1).padStart(3, '0');

                if (ASSET_IMAGES[imageIndex]) {
                    const img = ASSET_IMAGES[imageIndex];
                    const size = previewBall.radius * 2;
                    ctx.save();
                    ctx.translate(previewBall.x, previewBall.y);
                    ctx.drawImage(img, -previewBall.radius, -previewBall.radius, size, size);
                    ctx.restore();
                } else {
                    // Fallback if not loaded (shouldn't happen with preloader)
                    ctx.beginPath();
                    ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                    ctx.fillStyle = previewBall.color;
                    ctx.fill();
                }
            } else {
                // Fallback Color Mode
                ctx.beginPath();
                ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
                ctx.fillStyle = previewBall.color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    });

    // Physics Loop Updates
    Events.on(engine, 'beforeUpdate', () => {
        if (isGameOver) return;

        // Orbit Logic
        orbitAngle -= orbitSpeed; // Counter-Clockwise
        if (previewBall) {
            previewBall.x = CENTER.x + Math.cos(orbitAngle) * ORBIT_RADIUS;
            previewBall.y = CENTER.y + Math.sin(orbitAngle) * ORBIT_RADIUS;
        }

        // Apply Central Gravity and Check Warning/Game Over
        let warningTriggered = false;
        const bodies = Composite.allBodies(engine.world);

        bodies.forEach(body => {
            if (body.isStatic) return;

            // Vector to center
            const dx = CENTER.x - body.position.x;
            const dy = CENTER.y - body.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Gravity
            if (distance > 10) {
                // Adaptive Gravity: Strong far away, weak near center to prevent crushing/jitter
                let gravityStrength = 0.001;
                if (distance < 40) gravityStrength = 0.0003;

                const forceMagnitude = gravityStrength * body.mass;
                Body.applyForce(body, body.position, {
                    x: (dx / distance) * forceMagnitude,
                    y: (dy / distance) * forceMagnitude
                });
            }

            // Stabilization / Braking
            if (body.speed < 1 && !body.isStatic) {
                // 1. Slow down gradually (95% speed per frame)
                Body.setVelocity(body, {
                    x: body.velocity.x * 0.95,
                    y: body.velocity.y * 0.95
                });

                // 2. Final Stop: If it's crawling very slow, force it to stop
                if (body.speed < 0.03) {
                    Body.setVelocity(body, { x: 0, y: 0 });
                    Body.setAngularVelocity(body, 0);
                }
            }



            // Check Distances
            const edgeDist = distance + body.circleRadius;

            // Warning Check
            if (edgeDist > WARNING_TRIGGER_RADIUS) {
                if (body.id !== (lastShotBodyId || -1)) {
                    warningTriggered = true;
                } else if (body.speed < 2) {
                    warningTriggered = true;
                }
            }

            // Game Over Check
            if (edgeDist > GAMEOVER_RADIUS) {
                if (body.speed < 0.2 && body.id !== (lastShotBodyId || -1)) {
                    endGame();
                }
            }

            // Pop Animation
            if (body.isPopping) {
                const targetRadius = BALL_RADII[body.level];
                if (body.circleRadius > targetRadius + 0.5) {
                    const scaleFactor = 0.95;
                    Body.scale(body, scaleFactor, scaleFactor);
                } else {
                    body.isPopping = false;
                }
            }
        });

        isWarningActive = warningTriggered;
    });

    // Collision & Merge Logic
    Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; i++) {
            const bodyA = pairs[i].bodyA;
            const bodyB = pairs[i].bodyB;

            if (bodyA.level !== undefined && bodyB.level !== undefined) {
                if (bodyA.level === bodyB.level && bodyA.level < 11) { // 12 levels (0-11)
                    mergeBalls(bodyA, bodyB);
                }
            }
        }
    });

    // Input Handling (Click Anywhere)
    const container = document.getElementById('game-container');
    container.addEventListener('mousedown', handleInput);
    container.addEventListener('touchstart', handleInput, { passive: false });

    spawnPreview();
}

let lastShotBodyId = null;

function handleInput(e) {
    if (e.target.tagName === 'BUTTON' || e.target.parentElement.tagName === 'BUTTON') return;
    if (e.type === 'touchstart') e.preventDefault();
    if (isGameOver) return;

    if (!isPlaying) {
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';

        // Show the next ball preview once game starts
        updateNextPreviewUI();

        // Try play BGM on first interaction
        if (bgm.paused && bgm.volume > 0) {
            bgm.play().catch(e => console.log("BGM waiting for interaction"));
        }
    }

    shoot();
}

function showStartMessage() {
    const existingMsg = document.getElementById('start-message');
    if (existingMsg) existingMsg.remove();

    const msg = document.createElement('div');
    msg.id = 'start-message';
    msg.innerHTML = "<h1>Tap Anywhere<br>to Start</h1>";
    msg.style.position = 'absolute';
    msg.style.top = '50%';
    msg.style.left = '50%';
    msg.style.transform = 'translate(-50%, -50%)';
    msg.style.textAlign = 'center';
    msg.style.width = '100%';
    msg.style.color = 'white';
    msg.style.fontSize = '32px';
    msg.style.pointerEvents = 'none';
    msg.style.textShadow = '0 0 10px black';
    msg.style.zIndex = '5';
    document.getElementById('game-container').appendChild(msg);
}

function spawnPreview() {
    if (upcomingLevels.length < 1) {
        upcomingLevels.push(Math.floor(Math.random() * 4));
    }

    const level = upcomingLevels.shift();
    upcomingLevels.push(Math.floor(Math.random() * 4));

    const radius = BALL_RADII[level];
    const color = BALL_COLORS[level];

    previewBall = {
        level: level,
        radius: radius,
        color: color,
        x: CENTER.x + ORBIT_RADIUS,
        y: CENTER.y
    };

    updateNextPreviewUI();
}

function updateNextPreviewUI() {
    const slot1 = document.getElementById('next-ball-1');
    if (!slot1) return;

    // 遊戲尚未開始前，因為軌道上還沒有球，所以「Next」預覽顯示為第一顆即將出現的球（previewBall）
    // 遊戲開始後軌道上已經有球了，所以「Next」顯示為再下一顆即將出現的球（upcomingLevels[0]）
    let lvl = upcomingLevels[0];
    if (!isPlaying && previewBall) {
        lvl = previewBall.level;
    }

    if (USE_IMAGES) {
        slot1.style.backgroundImage = `url('assets/${String(lvl + 1).padStart(3, '0')}.PNG')`;
        slot1.style.backgroundColor = 'transparent';
    } else {
        slot1.style.backgroundImage = 'none';
        slot1.style.backgroundColor = BALL_COLORS[lvl];
    }
}

function shoot() {
    if (!previewBall || isGameOver) return;

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(previewBall.level + 1).padStart(3, '0')}.PNG`,
            xScale: (previewBall.radius * 2) / 250, // Source: 250px
            yScale: (previewBall.radius * 2) / 250
        }
    } : {
        fillStyle: previewBall.color
    };

    const body = Bodies.circle(previewBall.x, previewBall.y, previewBall.radius, {
        restitution: 0.4,
        friction: 0.05,
        frictionAir: 0.03,
        render: renderConfig
    });

    body.level = previewBall.level;
    lastShotBodyId = body.id;

    const dx = CENTER.x - previewBall.x;
    const dy = CENTER.y - previewBall.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 6;

    Body.setVelocity(body, {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed
    });

    // Play Shoot Sound
    playSound(clickSound);

    World.add(engine.world, body);

    if (spawnTimeoutId) {
        clearTimeout(spawnTimeoutId);
    }
    previewBall = null;
    spawnTimeoutId = setTimeout(spawnPreview, 500);
}

function mergeBalls(bodyA, bodyB) {
    if (bodyA.isRemoved || bodyB.isRemoved) return;
    bodyA.isRemoved = true;
    bodyB.isRemoved = true;

    const midX = (bodyA.position.x + bodyB.position.x) / 2;
    const midY = (bodyA.position.y + bodyB.position.y) / 2;
    const newLevel = bodyA.level + 1;

    World.remove(engine.world, [bodyA, bodyB]);

    score += (newLevel + 1) * 10;
    scoreEl.textContent = score;

    checkLevelUp(score);

    // Play Merge Sound
    playSound(mergeSound);

    const radius = BALL_RADII[newLevel];

    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${String(newLevel + 1).padStart(3, '0')}.PNG`,
            xScale: (radius * 2) / 250, // Source: 250px
            yScale: (radius * 2) / 250
        }
    } : {
        fillStyle: BALL_COLORS[newLevel]
    };

    const newBody = Bodies.circle(midX, midY, radius, {
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.02,
        render: renderConfig
    });
    newBody.level = newLevel;
    Body.setVelocity(newBody, { x: (Math.random() - 0.5), y: (Math.random() - 0.5) });

    // Pop Animation
    Body.scale(newBody, 1.1, 1.1);
    newBody.isPopping = true;

    World.add(engine.world, newBody);
}

function checkLevelUp(currentScore) {
    if (currentScore < 2000) return;
    let newLevel = 1 + Math.floor((currentScore - 2000) / 1500);
    newLevel = Math.min(newLevel, 10);

    if (newLevel > currentSpeedLevel) {
        currentSpeedLevel = newLevel;
        orbitSpeed = 0.02 * (1 + 0.1 * currentSpeedLevel);
        showLevelUpText();
    }
}

function showLevelUpText() {
    const container = document.getElementById('ui-layer');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'level-up-container level-up-anim';
    msg.innerHTML = '<span class="arrow">↑</span><span>level up</span><span class="arrow">↑</span>';
    container.appendChild(msg);

    setTimeout(() => {
        if (msg.parentElement) msg.remove();
    }, 3000);
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    finalScoreEl.textContent = score;
    // Show Header and Footer, Hide In-Game UI
    gameHeader.classList.remove('hidden');
    gameFooter.classList.remove('hidden');
    uiLayer.classList.add('hidden');
}

function resetGame() {
    if (spawnTimeoutId) {
        clearTimeout(spawnTimeoutId);
        spawnTimeoutId = null;
    }

    World.clear(engine.world);
    Engine.clear(engine);
    score = 0;
    scoreEl.textContent = '0';
    currentSpeedLevel = 0;
    orbitSpeed = 0.02;
    isGameOver = false;
    upcomingLevels = [];
    previewBall = null;
    // Hide Header and Footer, Show In-Game UI
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    isPlaying = false;
    showStartMessage();
    spawnPreview();
}

// Helper to play SFX (clone node to allow overlapping)
function playSound(audio) {
    if (audio.volume > 0) {
        const clone = audio.cloneNode();
        clone.volume = audio.volume;
        clone.play().catch(e => console.warn('Audio play failed', e));
    }
}

// Global UI Handlers
if (retryBtnTop) retryBtnTop.addEventListener('click', resetGame);
if (retryBtn) retryBtn.addEventListener('click', resetGame);

// Settings UI Handlers
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
        settingsModal.style.display = 'flex';
        // Pause game? Maybe not, keep it flowing
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        settingsModal.style.display = 'none';

        // Ensure BGM starts if it wasn't playing (user interaction)
        if (bgm.paused && bgm.volume > 0) {
            bgm.play().catch(e => console.warn("BGM autoplay prevented", e));
        }
    });
}

bgmSlider.addEventListener('input', (e) => {
    bgmVolume = e.target.value / 100;
    bgm.volume = bgmVolume;
    if (bgmVolume > 0 && bgm.paused) {
        bgm.play().catch(e => console.warn("BGM play failed", e));
    }
});

sfxSlider.addEventListener('input', (e) => {
    sfxVolume = e.target.value / 100;
    clickSound.volume = sfxVolume;
    mergeSound.volume = sfxVolume;
});


if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        // Manual Screenshot Composition
        // 1. Create a temporary canvas
        const captureCanvas = document.createElement('canvas');
        const gameCanvas = document.querySelector('#game-container canvas'); // Matter.js canvas

        if (!gameCanvas) {
            alert('Game canvas not found!');
            return;
        }

        captureCanvas.width = gameCanvas.width;
        captureCanvas.height = gameCanvas.height + 150; // Extra height for Header/Footer info
        const ctx = captureCanvas.getContext('2d');

        // 2. Fill Background
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);

        // 3. Draw Header Info manually (Since we can't capture HTML easily without html2canvas issues)
        // Center the content vertically/horizontally
        const centerX = captureCanvas.width / 2;

        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'white';
        ctx.strokeText('Game Over', centerX, 60);
        ctx.fillText('Game Over', centerX, 60);

        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Arial';
        ctx.fillText('Score: ' + score, centerX, 110);

        // 4. Draw Game Canvas
        // Position it below the header
        const gameY = 150;
        ctx.drawImage(gameCanvas, 0, gameY);

        // 5. Download
        try {
            const dataURL = captureCanvas.toDataURL('image/PNG');
            const link = document.createElement('a');
            link.download = `ComboGame_Score_${score}.PNG`;
            link.href = dataURL;
            link.click();
        } catch (err) {
            console.error(err);
            alert('Screenshot failed. If you are running locally (file://), browsers verify security. Please try on a local server or GitHub Pages.');
        }
    });
}

if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        const url = "https://nikaworx.com/Fuwavity/";
        const text = `I scored ${score} in Fuwavity! Can you beat me? ${url}`;
        if (navigator.share) {
            navigator.share({ title: 'Fuwavity', text: text, url: url });
        } else {
            navigator.clipboard.writeText(text);
            alert('Copied to clipboard!');
        }
    });
}

// Start
// init(); // Removed, called by preloadAssets
preloadAssets();
