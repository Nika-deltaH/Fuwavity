const { Engine, Render, Runner, World, Bodies, Body, Events, Composite, Vector, Detector } = Matter;

// Configuration
const GAME_SIZE = 800; // Canvas size (Internal logical size)
const CENTER = { x: GAME_SIZE / 2, y: GAME_SIZE / 2 };
const BOWL_RADIUS = 150; // 300px diameter (Requested)
const ORBIT_RADIUS = 200; // 400px diameter (Requested)
const GAMEOVER_RADIUS = 152.5; // 305px diameter
const WARNING_TRIGGER_RADIUS = 145; // 290px diameter
const WARNING_LINE_RADIUS = 150; // 300px diameter

// Sizes: 15, 20, 30, 40, 50, 60, 70, 80, 90, 100
const BALL_RADII = [7.5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

// Placeholder Colors
const BALL_COLORS = [
    '#FF3333', '#FF9933', '#FFFF33', '#33FF33', '#33FFFF',
    '#3333FF', '#9933FF', '#FF33FF', '#FFFFFF', '#000000'
];

// --- IMAGE REPLACEMENT CONFIGURATION ---
// To use images:
// 1. Put images named 1.png, 2.png... 10.png in the 'assets' folder.
// 2. Set USE_IMAGES = true;
const USE_IMAGES = false;
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
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const gameOverScreen = document.getElementById('game-over-screen');
const retryBtn = document.getElementById('retry-btn');
// const goBtn = document.getElementById('go-btn'); // Removed
const shareBtn = document.getElementById('share-btn');

function init() {
    // Create Engine
    engine = Engine.create();
    engine.world.gravity.y = 0;

    // Create Renderer
    // We keep internal size 800x800 for consistent physics, 
    // but CSS will scale it to fit screen.
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
                // --- IMAGE RENDERING ---
                // If using images, we need to draw the image instead of circle
                // This is a manual draw for the preview (since it's not a body yet)
                const img = new Image();
                img.src = `assets/${previewBall.level + 1}.png`; // 1.png, 2.png...
                // Note: Loading, creating new Image every frame is inefficient but works for this level of demo.
                // Ideally preload or cache.
                /*
                const size = previewBall.radius * 2;
                ctx.drawImage(img, previewBall.x - previewBall.radius, previewBall.y - previewBall.radius, size, size);
                */
                // Only draw logic if we actually implemented the loader check, for now fallback to color with comment.
            }

            // Fallback / Color Mode (Always draw circle unless specific override)
            ctx.beginPath();
            ctx.arc(previewBall.x, previewBall.y, previewBall.radius, 0, 2 * Math.PI);
            ctx.fillStyle = previewBall.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
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

            // Warning Check (290px -> 145 radius)
            if (edgeDist > WARNING_TRIGGER_RADIUS) {
                if (body.id !== (lastShotBodyId || -1)) {
                    warningTriggered = true;
                } else if (body.speed < 2) {
                    warningTriggered = true;
                }
            }

            // Game Over Check (305px -> 152.5 radius)
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
                if (bodyA.level === bodyB.level && bodyA.level < 9) {
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
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scroll

    // Check if clicking a button
    if (e.target.tagName === 'BUTTON') return;

    if (isGameOver) return;

    if (!isPlaying) {
        isPlaying = true;
        const msg = document.getElementById('start-message');
        if (msg) msg.style.display = 'none';
        // return; // REMOVED to allow immediate shoot
    }

    shoot();
}

function showStartMessage() {
    const msg = document.createElement('div');
    msg.id = 'start-message';
    msg.innerHTML = "<h1>Tap Anywhere to Start</h1>";
    msg.style.position = 'absolute';
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

    // Create physical body
    const renderConfig = USE_IMAGES ? {
        sprite: {
            texture: `assets/${previewBall.level + 1}.png`,
            xScale: (previewBall.radius * 2) / 100, // Assuming 100px source image
            yScale: (previewBall.radius * 2) / 100
        }
    } : {
        fillStyle: previewBall.color
    };

    const body = Bodies.circle(previewBall.x, previewBall.y, previewBall.radius, {
        restitution: 0.3,
        friction: 0.005,
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
            texture: `assets/${newLevel + 1}.png`,
            xScale: (radius * 2) / 100,
            yScale: (radius * 2) / 100
        }
    } : {
        fillStyle: BALL_COLORS[newLevel]
    };

    const newBody = Bodies.circle(midX, midY, radius, {
        restitution: 0.3,
        friction: 0.005,
        frictionAir: 0.02,
        render: renderConfig
    });
    newBody.level = newLevel;
    Body.setVelocity(newBody, { x: (Math.random() - 0.5), y: (Math.random() - 0.5) });

    // Pop Animation: Start larger
    Body.scale(newBody, 1.2, 1.2);
    newBody.isPopping = true;

    World.add(engine.world, newBody);
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    finalScoreEl.textContent = score;
    gameOverScreen.classList.remove('hidden');
}

function resetGame() {
    World.clear(engine.world);
    Engine.clear(engine);
    score = 0;
    scoreEl.textContent = '0';
    isGameOver = false;
    gameOverScreen.classList.add('hidden');
    isPlaying = false;
    showStartMessage();
    spawnPreview();
}

// Global UI Handlers
document.getElementById('retry-btn-top').addEventListener('click', resetGame);
document.getElementById('retry-btn').addEventListener('click', resetGame);
document.getElementById('share-btn').addEventListener('click', () => {
    const text = `I scored ${score} in ComboGame! Can you beat me?`;
    if (navigator.share) {
        navigator.share({
            title: 'ComboGame',
            text: text,
            url: window.location.href
        });
    } else {
        alert('Share copied to clipboard: ' + text);
        navigator.clipboard.writeText(text);
    }
});

// Start
init();
