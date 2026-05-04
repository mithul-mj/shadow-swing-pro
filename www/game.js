/**
 * Shadow Swing Pro — Professional Mobile Edition
 * High-fidelity graphics, optimized for Play Store.
 */

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'game-container',
    backgroundColor: '#050508',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 1400 },
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let player;
let anchors;
let webGraphics;
let backgroundGroups = [];
let buildingGroups = [];
let scoreText;
let distance = 0;
let isSwinging = false;
let currentAnchor = null;
let swingAngle = 0;
let swingDistance = 0;
let swingSpeed = 0;

function preload() {
    this.load.spritesheet('player_run', 'assets/sheets/run.png', { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('player_swing', 'assets/sheets/swing.png', { frameWidth: 128, frameHeight: 128 });
    this.load.image('bird', 'assets/sheets/bird.png');
    this.load.audio('thwip', 'assets/sound/thwip.mp3');
}

function create() {
    const { width, height } = this.scale;

    // 1. Create Parallax Backgrounds
    createAtmosphere(this);
    
    // 2. Create Building Layers
    createBuildings(this);

    // 3. Create Graphics for the Web
    webGraphics = this.add.graphics();

    // 4. Create Player
    player = this.physics.add.sprite(width * 0.2, height * 0.5, 'player_run');
    player.setScale(0.8);
    player.setDepth(10);

    // Animations
    this.anims.create({
        key: 'run',
        frames: this.anims.generateFrameNumbers('player_run', { start: 0, end: 7 }),
        frameRate: 14,
        repeat: -1
    });

    this.anims.create({
        key: 'swing',
        frames: this.anims.generateFrameNumbers('player_swing', { start: 0, end: 5 }),
        frameRate: 12,
        repeat: 0
    });

    player.play('run');

    // 5. Create Crane Anchors
    anchors = this.add.group();
    generateInitialCranes(this);

    // 6. UI
    scoreText = this.add.text(20, 20, 'Distance: 0m', {
        fontSize: '24px',
        fontFamily: 'Arial',
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
    }).setScrollFactor(0).setDepth(100);

    // 7. Input
    this.input.on('pointerdown', startSwing, this);
    this.input.on('pointerup', stopSwing, this);

    // Camera
    this.cameras.main.startFollow(player, true, 0.1, 0.1, -width * 0.3, height * 0.1);
}

function update(time, delta) {
    webGraphics.clear();

    if (isSwinging && currentAnchor) {
        handleSwinging(this);
    } else {
        if (player.y > this.scale.height + 500) {
            resetGame(this);
        }
    }

    // Update Score
    if (player.x > distance) {
        distance = Math.floor(player.x / 10);
        scoreText.setText(`Distance: ${distance}m`);
    }

    // Procedural Infinite World
    updateParallax(this);
    updateBuildings(this);
    updateCranes(this);
}

function createAtmosphere(scene) {
    const { width, height } = scene.scale;
    // Add a dark blue gradient overlay or clouds if needed
    let bg = scene.add.graphics();
    bg.fillGradientStyle(0x050508, 0x050508, 0x101018, 0x101018, 1);
    bg.fillRect(0, 0, width, height);
    bg.setScrollFactor(0);
    bg.setDepth(-100);
}

function createBuildings(scene) {
    const layerCount = 3;
    const colors = [0x08080a, 0x0c0c0f, 0x15151a];
    const speeds = [0.2, 0.5, 0.8];

    for (let i = 0; i < layerCount; i++) {
        let group = scene.add.group();
        for (let j = 0; j < 10; j++) {
            let b = drawBuilding(scene, j * 300, colors[i], i);
            b.setData('speed', speeds[i]);
            group.add(b);
        }
        buildingGroups.push(group);
    }
}

function drawBuilding(scene, x, color, layer) {
    const height = 300 + Math.random() * 400;
    const width = 150 + Math.random() * 100;
    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(x, scene.scale.height - height, width, height);
    
    // Add glowing windows
    g.fillStyle(0xffffaa, 0.1);
    for(let r = 0; r < height/40; r++) {
        for(let c = 0; c < width/30; c++) {
            if(Math.random() > 0.7) {
                g.fillRect(x + 10 + c*30, scene.scale.height - height + 20 + r*40, 15, 20);
            }
        }
    }
    g.setDepth(-50 + layer);
    return g;
}

function generateInitialCranes(scene) {
    for (let i = 0; i < 6; i++) {
        createCrane(scene, 600 + i * 450);
    }
}

function createCrane(scene, x) {
    const height = 150 + Math.random() * 150;
    const g = scene.add.graphics();
    
    // Draw Crane Structure (Lattice)
    g.lineStyle(3, 0x222222, 1);
    g.beginPath();
    g.moveTo(x, scene.scale.height);
    g.lineTo(x, height);
    g.lineTo(x + 200, height); // Jib
    g.strokePath();

    // Lattice pattern
    g.lineStyle(1, 0x333333, 0.5);
    for(let i = scene.scale.height; i > height; i -= 40) {
        g.lineBetween(x-10, i, x+10, i-40);
        g.lineBetween(x+10, i, x-10, i-40);
    }

    // Anchor point (tip of the jib)
    const anchor = scene.add.circle(x + 180, height, 5, 0xff0000, 0);
    anchor.setData('graphics', g);
    anchors.add(anchor);
}

function startSwing() {
    let closest = null;
    let minDist = Infinity;

    anchors.getChildren().forEach(anchor => {
        const dist = Phaser.Math.Distance.Between(player.x, player.y, anchor.x, anchor.y);
        if (anchor.x > player.x && dist < 500 && dist < minDist) {
            minDist = dist;
            closest = anchor;
        }
    });

    if (closest) {
        isSwinging = true;
        currentAnchor = closest;
        swingDistance = Phaser.Math.Distance.Between(player.x, player.y, currentAnchor.x, currentAnchor.y);
        swingAngle = Phaser.Math.Angle.Between(currentAnchor.x, currentAnchor.y, player.x, player.y);
        
        const velocity = Math.sqrt(player.body.velocity.x ** 2 + player.body.velocity.y ** 2);
        swingSpeed = velocity / swingDistance;

        player.body.setAllowGravity(false);
        player.play('swing');
        this.sound.play('thwip', { volume: 0.4 });
    }
}

function stopSwing() {
    if (isSwinging) {
        isSwinging = false;
        player.body.setAllowGravity(true);
        const vx = -Math.sin(swingAngle) * swingSpeed * swingDistance;
        const vy = Math.cos(swingAngle) * swingSpeed * swingDistance;
        player.body.setVelocity(vx * 1.6, vy * 1.6);
        player.play('run');
        currentAnchor = null;
    }
}

function handleSwinging(scene) {
    const gravity = 0.006;
    const force = Math.cos(swingAngle) * gravity;
    swingSpeed -= force;
    swingAngle += swingSpeed;

    player.x = currentAnchor.x + Math.cos(swingAngle) * swingDistance;
    player.y = currentAnchor.y + Math.sin(swingAngle) * swingDistance;

    webGraphics.lineStyle(3, 0xffffff, 0.9);
    webGraphics.beginPath();
    webGraphics.moveTo(currentAnchor.x, currentAnchor.y);
    webGraphics.lineTo(player.x, player.y);
    webGraphics.strokePath();
}

function updateBuildings(scene) {
    buildingGroups.forEach(group => {
        group.getChildren().forEach(b => {
            const speed = b.getData('speed');
            // Subtle movement or wrap
            if (b.x < scene.cameras.main.scrollX - 400) {
                b.x += 2500;
            }
        });
    });
}

function updateCranes(scene) {
    anchors.getChildren().forEach(anchor => {
        if (anchor.x < player.x - 800) {
            const g = anchor.getData('graphics');
            g.clear();
            anchor.x += 2400;
            // Redraw at new position
            const h = 150 + Math.random() * 150;
            anchor.y = h;
            g.lineStyle(3, 0x222222, 1);
            g.lineBetween(anchor.x - 180, scene.scale.height, anchor.x - 180, h);
            g.lineBetween(anchor.x - 180, h, anchor.x + 20, h);
        }
    });
}

function updateParallax(scene) {
    // Parallax is handled implicitly by scrollFactors if we set them, 
    // but for procedural we wrap them
}

function resetGame(scene) {
    distance = 0;
    player.x = scene.scale.width * 0.2;
    player.y = scene.scale.height * 0.5;
    player.body.setVelocity(0, 0);
    isSwinging = false;
    currentAnchor = null;
}
