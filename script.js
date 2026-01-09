const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Vector, Detector } = Matter;

// Configuration
const GAME_SIZE = 460; // Canvas size (Internal logical size)
const CENTER = { x: GAME_SIZE / 2, y: GAME_SIZE / 2 };
const BOWL_RADIUS = 150; // 300px diameter (Requested)
const ORBIT_RADIUS = 200; // 400px diameter (Requested)
const GAMEOVER_RADIUS = 152.5; // 305px diameter
const WARNING_TRIGGER_RADIUS = 145; // 290px diameter
const WARNING_LINE_RADIUS = 150; // 300px diameter

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

// The ball currently orbiting and waiting to be dropped
let previewBall = null;
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


function init() {
    // Create Engine
    engine = Engine.create();
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
            pixelRatio: window.devicePixelRatio
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
                // Image Rendering
                const imageIndex = String(previewBall.level + 1).padStart(3, '0');
                // Note: creating new image every frame is bad practice usually, but for low-freq preview works here.
                // Ideally we pre-load, but assuming browser cache handles it.
                const img = new Image();
                img.src = `assets/${imageIndex}.PNG`;

                const size = previewBall.radius * 2;

                ctx.save();
                ctx.translate(previewBall.x, previewBall.y);
                ctx.drawImage(img, -previewBall.radius, -previewBall.radius, size, size);
                ctx.restore();
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
                const forceMagnitude = 0.0005 * body.mass;
                Body.applyForce(body, body.position, {
                    x: (dx / distance) * forceMagnitude,
                    y: (dy / distance) * forceMagnitude
                });
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
                if (body.speed < 0.5 && body.id !== (lastShotBodyId || -1)) {
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
    const level = Math.floor(Math.random() * 4);
    const radius = BALL_RADII[level];
    const color = BALL_COLORS[level];

    previewBall = {
        level: level,
        radius: radius,
        color: color,
        x: CENTER.x + ORBIT_RADIUS,
        y: CENTER.y
    };
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
        restitution: 0.5,
        friction: 0.05,
        frictionAir: 0.02,
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

    World.add(engine.world, body);
    previewBall = null;

    setTimeout(spawnPreview, 500);
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
        restitution: 0.5,
        friction: 0.05,
        frictionAir: 0.02,
        render: renderConfig
    });
    newBody.level = newLevel;
    Body.setVelocity(newBody, { x: (Math.random() - 0.5), y: (Math.random() - 0.5) });

    // Pop Animation
    Body.scale(newBody, 1.2, 1.2);
    newBody.isPopping = true;

    World.add(engine.world, newBody);
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
    World.clear(engine.world);
    Engine.clear(engine);
    score = 0;
    scoreEl.textContent = '0';
    isGameOver = false;
    // Hide Header and Footer, Show In-Game UI
    gameHeader.classList.add('hidden');
    gameFooter.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    isPlaying = false;
    showStartMessage();
    spawnPreview();
}

// Global UI Handlers
if (retryBtnTop) retryBtnTop.addEventListener('click', resetGame);
if (retryBtn) retryBtn.addEventListener('click', resetGame);

if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        // Screenshot Logic: Capture Main Wrapper logic
        // Hide buttons for screenshot
        gameFooter.classList.add('hidden');
        if (retryBtnTop) retryBtnTop.style.display = 'none';

        html2canvas(mainWrapper, {
            backgroundColor: '#222', // Match Theme
            scale: 2, // High Res
            useCORS: true,
            // allowTaint removed to avoid SecurityError on toDataURL
            logging: false
        }).then(canvas => {
            // Restore
            gameFooter.classList.remove('hidden');
            if (retryBtnTop) retryBtnTop.style.display = 'block';

            const link = document.createElement('a');
            link.download = `ComboGame_Score_${score}.PNG`;
            link.href = canvas.toDataURL();
            link.click();
        }).catch(err => {
            console.error(err);
            gameFooter.classList.remove('hidden');
            if (retryBtnTop) retryBtnTop.style.display = 'block';
            alert('Screenshot failed.');
        });
    });
}

if (shareBtn) {
    shareBtn.addEventListener('click', () => {
        const url = "https://nika-deltah.github.io/ComboGame/";
        const text = `I scored ${score} in ComboGame! Can you beat me? ${url}`;
        if (navigator.share) {
            navigator.share({ title: 'ComboGame', text: text, url: url });
        } else {
            navigator.clipboard.writeText(text);
            alert('Copied to clipboard!');
        }
    });
}

// Start
init();

