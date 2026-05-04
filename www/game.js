/**
 * Shadow Swing Pro — Professional Mobile Edition
 * Built with Phaser 3 for Play Store readiness.
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
            gravity: { y: 1200 },
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
let isSwinging = false;
let currentAnchor = null;
let swingAngle = 0;
let swingDistance = 0;
let swingSpeed = 0;

function preload() {
    // Load SpriteSheets
    this.load.spritesheet('player_run', 'assets/sheets/run.png', { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('player_swing', 'assets/sheets/swing.png', { frameWidth: 128, frameHeight: 128 });
    
    // Load UI/Environment
    this.load.image('bird', 'assets/sheets/bird.png');
    this.load.audio('thwip', 'assets/sound/thwip.mp3');
}

function create() {
    const { width, height } = this.scale;

    // Create Graphics for the Web
    webGraphics = this.add.graphics();

    // Create Player
    player = this.physics.add.sprite(width * 0.2, height * 0.5, 'player_run');
    player.setCollideWorldBounds(false);
    player.setBounce(0.1);
    player.setScale(0.8);

    // Create Animations
    this.anims.create({
        key: 'run',
        frames: this.anims.generateFrameNumbers('player_run', { start: 0, end: 7 }),
        frameRate: 12,
        repeat: -1
    });

    this.anims.create({
        key: 'swing',
        frames: this.anims.generateFrameNumbers('player_swing', { start: 0, end: 5 }),
        frameRate: 10,
        repeat: 0
    });

    player.play('run');

    // Create Anchor Points (Procedural Simulation)
    anchors = this.add.group();
    generateInitialAnchors(this);

    // Input Handling (Touch for Mobile)
    this.input.on('pointerdown', startSwing, this);
    this.input.on('pointerup', stopSwing, this);

    // Camera follow
    this.cameras.main.startFollow(player, true, 0.1, 0.1, -width * 0.3, 0);
}

function update(time, delta) {
    webGraphics.clear();

    if (isSwinging && currentAnchor) {
        handleSwinging(this);
    } else {
        // Normal gravity handling
        if (player.y > this.scale.height + 200) {
            resetGame(this);
        }
    }

    // Keep generating anchors ahead of the player
    updateAnchors(this);
}

function startSwing(pointer) {
    // Find closest anchor ahead of player
    let closest = null;
    let minDist = Infinity;

    anchors.getChildren().forEach(anchor => {
        const dist = Phaser.Math.Distance.Between(player.x, player.y, anchor.x, anchor.y);
        if (anchor.x > player.x && dist < 400 && dist < minDist) {
            minDist = dist;
            closest = anchor;
        }
    });

    if (closest) {
        isSwinging = true;
        currentAnchor = closest;
        swingDistance = Phaser.Math.Distance.Between(player.x, player.y, currentAnchor.x, currentAnchor.y);
        swingAngle = Phaser.Math.Angle.Between(currentAnchor.x, currentAnchor.y, player.x, player.y);
        
        // Calculate initial swing speed based on player's current velocity
        const velocity = Math.sqrt(player.body.velocity.x ** 2 + player.body.velocity.y ** 2);
        swingSpeed = velocity / swingDistance;

        player.body.setAllowGravity(false);
        player.play('swing');
        this.sound.play('thwip', { volume: 0.5 });
    }
}

function stopSwing() {
    if (isSwinging) {
        isSwinging = false;
        player.body.setAllowGravity(true);
        
        // Transfer momentum back to velocity
        const vx = -Math.sin(swingAngle) * swingSpeed * swingDistance;
        const vy = Math.cos(swingAngle) * swingSpeed * swingDistance;
        player.body.setVelocity(vx * 1.5, vy * 1.5);
        
        player.play('run');
        currentAnchor = null;
    }
}

function handleSwinging(scene) {
    // Physics Math for the Arc
    const gravity = 0.005;
    const force = Math.cos(swingAngle) * gravity;
    swingSpeed -= force;
    swingAngle += swingSpeed;

    // Update Player Position based on the angle
    player.x = currentAnchor.x + Math.cos(swingAngle) * swingDistance;
    player.y = currentAnchor.y + Math.sin(swingAngle) * swingDistance;

    // Draw the Web line
    webGraphics.lineStyle(2, 0xffffff, 0.8);
    webGraphics.beginPath();
    webGraphics.moveTo(currentAnchor.x, currentAnchor.y);
    webGraphics.lineTo(player.x, player.y);
    webGraphics.strokePath();
}

function generateInitialAnchors(scene) {
    for (let i = 0; i < 5; i++) {
        const x = 400 + i * 350;
        const y = 100 + Math.random() * 200;
        const anchor = scene.add.circle(x, y, 5, 0xff0000, 0);
        anchors.add(anchor);
    }
}

function updateAnchors(scene) {
    anchors.getChildren().forEach(anchor => {
        if (anchor.x < player.x - 800) {
            anchor.x += 1750; // Wrap around to far right
            anchor.y = 100 + Math.random() * 200;
        }
    });
}

function resetGame(scene) {
    player.x = scene.scale.width * 0.2;
    player.y = scene.scale.height * 0.5;
    player.body.setVelocity(0, 0);
    isSwinging = false;
    currentAnchor = null;
}
