import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Reverse Frogger - arcade salvaje mejorado.
 *
 * Three.js r128.
 *
 * Mejoras principales:
 * - Ranas mucho más numerosas, con oleadas agresivas y movimiento lateral rápido.
 * - Salto vertical físico con seno de tiempo para que se vean en 3D.
 * - Animación GLB correcta con AnimationMixer independiente por rana.
 * - Colisiones más fiables usando cajas orientadas para el coche y cajas dinámicas para ranas.
 * - Carretera infinita procedural con textura de asfalto, arcenes y bordes.
 * - Terreno lateral, montañas lejanas, farolas, árboles, nubes y cielo estrellado.
 */

// -----------------------------------------------------------------------------
// Assets
// -----------------------------------------------------------------------------

const CAR_MODEL_URL = 'assets/vehicle_-_dodge_viper.glb';
const FROG_MODEL_URL = 'assets/frog_jump.glb';

const CAR_SCALE = 1;
const FROG_SCALE = 1;

// El modelo original del coche apunta a +Z. Con este hijo rotado, el morro
// apunta a -Z cuando coche.rotation.y === Math.PI.
const CAR_MODEL_ROTATION_Y = Math.PI;

// -----------------------------------------------------------------------------
// Carretera infinita, coche y cámara
// -----------------------------------------------------------------------------

const ROAD_WIDTH = 30;
const ROAD_HALF_WIDTH = ROAD_WIDTH / 2;
const ROAD_TILE_LENGTH = 1700;

const CAMERA_HEIGHT = 6;
const CAMERA_DISTANCE_BEHIND = 12;
const CAMERA_LOOK_AHEAD = 9;
const CAMERA_SMOOTHING = 8;

const CAR_MAX_FORWARD_SPEED = 34;
const CAR_MAX_REVERSE_SPEED = 14;
const CAR_ACCELERATION = 22;
const CAR_REVERSE_ACCELERATION = 18;
const CAR_BRAKE_ACCELERATION = 26;
const CAR_FRICTION = 8;
const CAR_TURN_SPEED = 2.75;

// -----------------------------------------------------------------------------
// Ranas, oleadas, colisiones y score
// -----------------------------------------------------------------------------

const FROG_SPAWN_INTERVAL = 0.34;
const FROG_SPAWN_DISTANCE_AHEAD = 86;
const FROG_SPAWN_SIDE_SPREAD = 13;
const FROG_SIDE_MARGIN = 2.2;
const FROG_REMOVE_DISTANCE = 190;

const FROG_JUMP_AMPLITUDE = 2.5;
const FROG_JUMP_FREQUENCY = 5;

const HIT_SCORE = 100;

// Array global solicitado para todas las ranas activas.
let ranasActivas = [];
let puntuacion = 0;

window.ranasActivas = ranasActivas;

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const container = document.getElementById('gameContainer');
const uiOverlay = document.getElementById('uiOverlay');
const endTitle = document.getElementById('endTitle');
const endMessage = document.getElementById('endMessage');
const restartButton = document.getElementById('restartButton');
const scoreValue = document.getElementById('scoreValue');

// -----------------------------------------------------------------------------
// Estado global
// -----------------------------------------------------------------------------

let scene;
let camera;
let renderer;
let clock;

let coche;
let originalFrogModel = null;
let frogAnimationClip = null;

let roadGroup;
let skyDome;
let stars;

let frogSpawnTimer = 0;
let environmentObjects = [];
let mountainObjects = [];

const keys = new Set();

const CONTROL_CODES = new Set([
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);

init();

// -----------------------------------------------------------------------------
// Inicialización
// -----------------------------------------------------------------------------

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020617);
  scene.fog = new THREE.Fog(0x07111f, 150, 520);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE_BEHIND);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  createSky();
  createLights();
  createWorld();
  createPlayerCar();
  setupInput();
  loadCarModel();
  loadOriginalFrogModel();

  restartButton.addEventListener('click', resetGame);
  window.addEventListener('resize', onWindowResize);

  resetGame();
  animate();
}

// -----------------------------------------------------------------------------
// Cielo nocturno, estrellas y nubes
// -----------------------------------------------------------------------------

function createSky() {
  const skyGeometry = new THREE.SphereGeometry(700, 32, 16);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x01030a) },
      horizonColor: { value: new THREE.Color(0x0f172a) },
      glowColor: { value: new THREE.Color(0x1e3a8a) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 glowColor;
      varying vec3 vWorldPosition;

      void main() {
        float h = normalize(vWorldPosition).y;
        float horizon = smoothstep(-0.18, 0.28, h);
        float top = smoothstep(0.15, 0.95, h);
        vec3 color = mix(horizonColor, topColor, top);
        color = mix(color, glowColor, smoothstep(-0.25, 0.15, h) * 0.22);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
  skyDome.name = 'Cielo nocturno procedural';
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  const starCount = 700;
  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i += 1) {
    starPositions[i * 3] = randomRange(-460, 460);
    starPositions[i * 3 + 1] = randomRange(32, 360);
    starPositions[i * 3 + 2] = randomRange(-460, 460);
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = 'Campo de estrellas';
  stars.renderOrder = -999;
  scene.add(stars);

  createClouds();
}

function createClouds() {
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  for (let i = 0; i < 18; i += 1) {
    const cloud = new THREE.Group();
    cloud.name = 'Nube procedural';

    const puffCount = 4 + Math.floor(Math.random() * 4);

    for (let p = 0; p < puffCount; p += 1) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(randomRange(7, 14), 12, 8),
        cloudMaterial,
      );
      puff.position.set(randomRange(-18, 18), randomRange(-1.2, 1.2), randomRange(-4, 4));
      puff.scale.y = randomRange(0.28, 0.45);
      cloud.add(puff);
    }

    cloud.position.set(randomRange(-260, 260), randomRange(95, 170), randomRange(-360, 360));
    cloud.renderOrder = -990;
    scene.add(cloud);
    environmentObjects.push(cloud);
  }
}

// -----------------------------------------------------------------------------
// Luces
// -----------------------------------------------------------------------------

function createLights() {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.52);
  scene.add(ambientLight);

  const moonLight = new THREE.DirectionalLight(0xffffff, 3.1);
  moonLight.position.set(-22, 42, 34);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 220;
  moonLight.shadow.camera.left = -90;
  moonLight.shadow.camera.right = 90;
  moonLight.shadow.camera.top = 90;
  moonLight.shadow.camera.bottom = -90;
  scene.add(moonLight);

  const hemisphereLight = new THREE.HemisphereLight(0x9bdcff, 0x3b2414, 0.72);
  scene.add(hemisphereLight);
}

// -----------------------------------------------------------------------------
// Mundo: carretera infinita, terreno, decoración y montañas
// -----------------------------------------------------------------------------

function createWorld() {
  roadGroup = new THREE.Group();
  roadGroup.name = 'Carretera infinita procedural';
  scene.add(roadGroup);

  createRoad(roadGroup);
  createSideTerrain(roadGroup);
  createRoadDetails(roadGroup);

  createInfiniteDecoration();
  createDistantMountains();
}

function createRoad(group) {
  const asphaltTexture = createAsphaltTexture();
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b2f36,
    map: asphaltTexture,
    roughness: 0.96,
    metalness: 0.02,
  });

  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_TILE_LENGTH), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.z = 0;
  road.receiveShadow = true;
  group.add(road);

  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.9,
  });

  [-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH].forEach((x) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, ROAD_TILE_LENGTH - 24), edgeMaterial);
    edge.position.set(x, 0.05, 0);
    group.add(edge);
  });
}

function createSideTerrain(group) {
  const terrainTexture = createTerrainTexture();

  const leftMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b5e34,
    map: terrainTexture,
    roughness: 1,
    metalness: 0,
  });
  const rightMaterial = leftMaterial.clone();

  const leftTerrain = new THREE.Mesh(new THREE.PlaneGeometry(260, ROAD_TILE_LENGTH), leftMaterial);
  leftTerrain.rotation.x = -Math.PI / 2;
  leftTerrain.position.set(-ROAD_HALF_WIDTH - 130, -0.065, 0);
  leftTerrain.receiveShadow = true;
  group.add(leftTerrain);

  const rightTerrain = new THREE.Mesh(new THREE.PlaneGeometry(260, ROAD_TILE_LENGTH), rightMaterial);
  rightTerrain.rotation.x = -Math.PI / 2;
  rightTerrain.position.set(ROAD_HALF_WIDTH + 130, -0.065, 0);
  rightTerrain.receiveShadow = true;
  group.add(rightTerrain);
}

function createRoadDetails(group) {
  const rumbleMaterial = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.82,
  });
  const darkRumbleMaterial = new THREE.MeshBasicMaterial({
    color: 0x111827,
    transparent: true,
    opacity: 0.86,
  });

  // Arcenes con patrón blanco/negro para reforzar sensación de velocidad.
  [-ROAD_HALF_WIDTH - 0.75, ROAD_HALF_WIDTH + 0.75].forEach((x) => {
    for (let z = -ROAD_TILE_LENGTH / 2 + 20; z < ROAD_TILE_LENGTH / 2 - 20; z += 20) {
      const rumble = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.035, 9), z % 40 === 0 ? rumbleMaterial : darkRumbleMaterial);
      rumble.position.set(x, 0.035, z);
      group.add(rumble);
    }
  });
}

function createInfiniteDecoration() {
  // Farolas y árboles cercanos al coche inicial para que el cambio sea visible.
  for (let z = -260; z <= 260; z += 38) {
    const isTreeRow = Math.floor(z / 38) % 2 === 0;

    [-1, 1].forEach((side) => {
      const x = side * (ROAD_HALF_WIDTH + (isTreeRow ? 12 : 7.2));
      const decoration = isTreeRow ? createTree() : createLamppost();
      decoration.position.set(x, 0, z + side * 8);
      roadGroup.add(decoration);
      environmentObjects.push(decoration);
    });
  }
}

function createDistantMountains() {
  const mountainMaterial = new THREE.MeshStandardMaterial({
    color: 0x172033,
    roughness: 1,
    metalness: 0,
  });
  const snowMaterial = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.9,
    metalness: 0,
  });

  for (let i = 0; i < 36; i += 1) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const mountain = new THREE.Group();
    mountain.name = 'Montaña lejana';

    const height = randomRange(28, 62);
    const radius = randomRange(18, 36);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5), mountainMaterial);
    cone.position.y = height / 2 - 2;
    cone.castShadow = true;
    cone.receiveShadow = true;
    mountain.add(cone);

    const snow = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.34, height * 0.28, 5), snowMaterial);
    snow.position.y = height - height * 0.18;
    mountain.add(snow);

    const x = side * randomRange(ROAD_HALF_WIDTH + 55, ROAD_HALF_WIDTH + 170);
    const z = randomRange(-360, 360);
    mountain.position.set(x, -0.1, z);
    mountain.rotation.y = randomRange(0, Math.PI);
    scene.add(mountain);
    mountainObjects.push(mountain);
  }
}

function createLamppost() {
  const group = new THREE.Group();
  group.name = 'Farola arcade';

  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.55,
    metalness: 0.38,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff7ed,
    emissive: 0xffd166,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 5.8, 12), poleMaterial);
  pole.position.y = 2.9;
  pole.castShadow = true;
  group.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.12), poleMaterial);
  arm.position.set(0.48, 5.55, 0);
  arm.castShadow = true;
  group.add(arm);

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 12), lampMaterial);
  lamp.position.set(1.12, 5.45, 0);
  group.add(lamp);

  return group;
}

function createTree() {
  const group = new THREE.Group();
  group.name = 'Árbol básico';

  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b3f22,
    roughness: 0.9,
  });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x14532d,
    roughness: 0.95,
  });
  const leafDarkMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f3d24,
    roughness: 0.95,
  });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 2.7, 10), trunkMaterial);
  trunk.position.y = 1.35;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.45, 3.4, 12), leafMaterial);
  crown.position.y = 3.55;
  crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(crown);

  const crown2 = new THREE.Mesh(new THREE.ConeGeometry(1.08, 2.7, 12), leafDarkMaterial);
  crown2.position.y = 4.85;
  crown2.castShadow = true;
  crown2.receiveShadow = true;
  group.add(crown2);

  return group;
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#252932';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 9000; i += 1) {
    const shade = Math.floor(randomRange(28, 58));
    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }

  for (let i = 0; i < 34; i += 1) {
    ctx.strokeStyle = `rgba(255,255,255,${randomRange(0.025, 0.06)})`;
    ctx.lineWidth = randomRange(1, 3);
    ctx.beginPath();
    ctx.moveTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.lineTo(Math.random() * canvas.width, Math.random() * canvas.height);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 34);
  texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  return texture;
}

function createTerrainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#7a5631';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 12000; i += 1) {
    const shade = Math.floor(randomRange(80, 150));
    ctx.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.68)}, ${Math.floor(shade * 0.38)})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 42);
  texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  return texture;
}

// -----------------------------------------------------------------------------
// Coche
// -----------------------------------------------------------------------------

function createPlayerCar() {
  coche = new THREE.Group();
  coche.name = 'Coche del jugador';
  coche.userData.speed = 0;
  coche.position.set(0, 0.05, 0);

  // Con rotación inicial Math.PI, W avanza hacia -Z usando sin/cos.
  coche.rotation.y = Math.PI;

  scene.add(coche);
}

function loadCarModel() {
  const loader = new GLTFLoader();

  loader.load(
    CAR_MODEL_URL,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      installModel(model, coche, CAR_SCALE, CAR_MODEL_ROTATION_Y);
    },
    undefined,
    (error) => {
      console.warn('No se pudo cargar el coche GLB. Usando modelo fallback.', error);
      installModel(createFallbackCar(), coche, 1, 0);
    },
  );
}

function installModel(model, parent, scale, rotationY) {
  clearChildren(parent);

  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;

      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((material) => {
          if (material.isMeshStandardMaterial || material.isMeshPhongMaterial) {
            material.roughness = Math.min(material.roughness ?? 0.6, 0.85);
          }
        });
      }
    }
  });

  model.scale.setScalar(scale);
  model.rotation.y = rotationY;
  centerModelOnGround(model);
  parent.add(model);
}

function clearChildren(parent) {
  while (parent.children.length > 0) {
    parent.remove(parent.children[0]);
  }
}

function centerModelOnGround(model) {
  const box = new THREE.Box3().setFromObject(model);

  if (!Number.isFinite(box.min.y)) {
    return;
  }

  model.position.y += -box.min.y;
}

function createFallbackCar() {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.45,
    metalness: 0.18,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.7,
    metalness: 0.1,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x93c5fd,
    roughness: 0.18,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
  });
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfbbf24,
    emissiveIntensity: 1.2,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.15, 4.2), bodyMaterial);
  body.position.y = 0.85;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.95, 1.35), glassMaterial);
  cabin.position.set(0, 1.65, -0.35);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelGeometry = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 24);
  [-1, 1].forEach((side) => {
    [-1.35, 1.35].forEach((z) => {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.82, 0.42, z);
      wheel.castShadow = true;
      group.add(wheel);
    });
  });

  [-0.55, 0.55].forEach((x) => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.06), lightMaterial);
    light.position.set(x, 0.95, -2.13);
    group.add(light);
  });

  return group;
}

// -----------------------------------------------------------------------------
// Ranas: carga, clonado, animación y spawner agresivo
// -----------------------------------------------------------------------------

function loadOriginalFrogModel() {
  const loader = new GLTFLoader();

  loader.load(
    'assets/frog_jump.glb',
    (gltf) => {
      originalFrogModel = gltf.scene || gltf.scenes[0];
      frogAnimationClip = gltf.animations && gltf.animations[0] ? gltf.animations[0] : null;

      prepareFrogModelMaterials(originalFrogModel);
      console.info('Rana cargada desde assets/frog_jump.glb. Spawner arcade activo.');
    },
    undefined,
    (error) => {
      console.error('No se pudo cargar assets/frog_jump.glb. Las ranas no aparecerán hasta resolver la ruta.', error);
    },
  );
}

function spawnFrogWave() {
  if (!coche || !originalFrogModel) {
    return;
  }

  // Oleadas grandes para llenar la carretera de forma divertida.
  const waveSize = randomInt(3, 7);
  const forward = getCarForwardVector();
  const right = getCarRightVector();
  const baseSpawn = coche.position.clone().addScaledVector(forward, FROG_SPAWN_DISTANCE_AHEAD);

  for (let i = 0; i < waveSize; i += 1) {
    if (ranasActivas.length >= 140) {
      break;
    }

    const orderedOffset = (i - (waveSize - 1) / 2) * randomRange(2.4, 4.2);
    const scatter = randomRange(-FROG_SPAWN_SIDE_SPREAD, FROG_SPAWN_SIDE_SPREAD);
    const depthScatter = randomRange(-18, 24);
    const spawnPosition = baseSpawn
      .clone()
      .addScaledVector(right, orderedOffset + scatter)
      .addScaledVector(forward, depthScatter);

    spawnPosition.x = clamp(spawnPosition.x, -ROAD_HALF_WIDTH + FROG_SIDE_MARGIN, ROAD_HALF_WIDTH - FROG_SIDE_MARGIN);
    spawnPosition.y = 0;

    spawnFrog(spawnPosition);
  }
}

function spawnFrog(position) {
  const frogGroup = new THREE.Group();
  frogGroup.name = 'Rana activa';
  frogGroup.position.copy(position);
  frogGroup.rotation.y = randomRange(0, Math.PI * 2);
  scene.add(frogGroup);

  const modelClone = originalFrogModel.clone(true);
  prepareFrogModelMaterials(modelClone);
  installFrogModel(frogGroup, modelClone);

  const speedX = randomSignedRange(10, 24);
  const directionToPlayer = Math.sign(coche.position.z - position.z) || -1;
  const speedZ = directionToPlayer * randomRange(8, 18) + randomRange(-3, 3);

  const frogData = {
    group: frogGroup,
    modelRoot: modelClone,
    mixer: null,
    animationAction: null,
    speedX,
    speedZ,
    wobble: randomRange(0, Math.PI * 2),
  };

  ranasActivas.push(frogData);
  setupFrogAnimation(frogData);
}

function installFrogModel(parent, model) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;

      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((material) => {
          if (material.isMeshStandardMaterial || material.isMeshPhongMaterial) {
            material.roughness = Math.min(material.roughness ?? 0.55, 0.82);
          }
        });
      }
    }
  });

  model.scale.setScalar(FROG_SCALE);
  centerModelOnGround(model);
  parent.add(model);
}

function prepareFrogModelMaterials(model) {
  model.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      const clonedMaterial = material.clone();
      clonedMaterial.needsUpdate = true;

      // Doble cara para evitar invisibilidad por normales/winding del GLB.
      clonedMaterial.side = THREE.DoubleSide;

      child.material = clonedMaterial;
    });
  });
}

function setupFrogAnimation(frogData) {
  if (!frogAnimationClip || !frogData.modelRoot) {
    return;
  }

  // Mixer independiente para cada rana, usando el primer clip del GLB.
  frogData.mixer = new THREE.AnimationMixer(frogData.modelRoot);
  frogData.animationAction = frogData.mixer.clipAction(frogAnimationClip);
  frogData.animationAction.clampWhenFinished = false;
  frogData.animationAction.setLoop(THREE.LoopRepeat, Infinity);
  frogData.animationAction.timeScale = randomRange(0.9, 1.35);
  frogData.animationAction.play();
}

// -----------------------------------------------------------------------------
// Movimiento de ranas y salto físico
// -----------------------------------------------------------------------------

function updateRanas(delta) {
  for (let index = ranasActivas.length - 1; index >= 0; index -= 1) {
    const frogData = ranasActivas[index];

    if (frogData.mixer) {
      frogData.mixer.update(delta);
    }

    // Cruce lateral rápido y variado.
    frogData.wobble += delta * randomRange(2.2, 4.8);
    frogData.group.position.x += (frogData.speedX + Math.sin(frogData.wobble) * 3.2) * delta;

    // Avance impredecible hacia la zona del coche.
    const desiredDirectionToPlayer = Math.sign(coche.position.z - frogData.group.position.z) || -1;
    const targetSpeedZ = desiredDirectionToPlayer * randomRange(9, 20);
    frogData.speedZ += (targetSpeedZ - frogData.speedZ) * 0.42 * delta;
    frogData.group.position.z += frogData.speedZ * delta;

    // Rebote lateral en los bordes para que no se pierdan fuera de la carretera.
    const minX = -ROAD_HALF_WIDTH + FROG_SIDE_MARGIN;
    const maxX = ROAD_HALF_WIDTH - FROG_SIDE_MARGIN;

    if (frogData.group.position.x < minX) {
      frogData.group.position.x = minX;
      frogData.speedX = Math.abs(frogData.speedX) * randomRange(1.08, 1.35);
    } else if (frogData.group.position.x > maxX) {
      frogData.group.position.x = maxX;
      frogData.speedX = -Math.abs(frogData.speedX) * randomRange(1.08, 1.35);
    }

    // Salto físico visible en Y usando la fórmula solicitada.
    frogData.group.position.y = Math.abs(Math.sin(clock.getElapsedTime() * 5)) * 2.5;

    // Rotación visual para que el salto/cruce se note más arcade.
    frogData.group.rotation.y += frogData.speedX * 0.16 * delta;

    if (frogData.group.position.distanceTo(coche.position) > FROG_REMOVE_DISTANCE) {
      removeFrogAt(index);
    }
  }
}

function removeFrogAt(index) {
  const frogData = ranasActivas[index];

  if (!frogData) {
    return;
  }

  if (frogData.mixer) {
    frogData.mixer.stopAllAction();
  }

  scene.remove(frogData.group);
  disposeObject(frogData.group);
  ranasActivas.splice(index, 1);
}

// -----------------------------------------------------------------------------
// Controles
// -----------------------------------------------------------------------------

function setupInput() {
  window.addEventListener('keydown', (event) => {
    if (CONTROL_CODES.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }

    if (event.code === 'KeyR') {
      resetGame();
    }
  });

  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
}

function getSteerInput() {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  return Number(left) - Number(right);
}

function getForwardInput() {
  return keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
}

function getBackwardInput() {
  return keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
}

// -----------------------------------------------------------------------------
// Bucle principal
// -----------------------------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.033);

  updateCar(delta);
  updateFrogSpawner(delta);
  updateRanas(delta);
  updateWorldFollow(delta);
  updateCollisions();
  updateCamera(delta);

  renderer.render(scene, camera);
}

function updateCar(delta) {
  if (!coche) {
    return;
  }

  const steer = getSteerInput();
  const forward = getForwardInput();
  const backward = getBackwardInput();
  const speed = coche.userData.speed;

  // A/D rotan suavemente sobre el eje Y del coche.
  if (steer !== 0) {
    const speedRatio = THREE.MathUtils.clamp(Math.abs(speed) / CAR_MAX_FORWARD_SPEED, 0, 1);
    const turnAuthority = 0.52 + speedRatio * 0.48;
    coche.rotation.y += steer * CAR_TURN_SPEED * turnAuthority * delta;
  }

  // W acelera hacia adelante; S frena y, si se mantiene, mete marcha atrás.
  if (forward > 0) {
    coche.userData.speed += CAR_ACCELERATION * delta;
  } else if (backward > 0) {
    coche.userData.speed -= speed >= 0 ? CAR_BRAKE_ACCELERATION * delta : CAR_REVERSE_ACCELERATION * delta;
  } else {
    coche.userData.speed = damp(speed, 0, CAR_FRICTION, delta);
  }

  coche.userData.speed = THREE.MathUtils.clamp(
    coche.userData.speed,
    -CAR_MAX_REVERSE_SPEED,
    CAR_MAX_FORWARD_SPEED,
  );

  if (Math.abs(coche.userData.speed) < 0.035) {
    coche.userData.speed = 0;
  }

  // Movimiento libre exacto en la dirección del morro.
  coche.position.x += Math.sin(coche.rotation.y) * coche.userData.speed * delta;
  coche.position.z += Math.cos(coche.rotation.y) * coche.userData.speed * delta;

  keepCarInsideRoadWidth();
}

function updateFrogSpawner(delta) {
  frogSpawnTimer += delta;

  if (frogSpawnTimer >= FROG_SPAWN_INTERVAL) {
    spawnFrogWave();
    frogSpawnTimer -= FROG_SPAWN_INTERVAL;
  }
}

function updateWorldFollow() {
  if (!coche) {
    return;
  }

  // El cielo y las estrellas siguen a la cámara para que el mundo parezca enorme.
  if (skyDome && camera) {
    skyDome.position.copy(camera.position);
  }

  if (stars && camera) {
    stars.position.copy(camera.position);
  }

  // La carretera es un tile largo que se reposiciona con el coche para simular infinito.
  if (roadGroup) {
    const tileZ = Math.round(coche.position.z / ROAD_TILE_LENGTH) * ROAD_TILE_LENGTH;
    roadGroup.position.z = tileZ;
  }

  // Decoración infinita: los objetos que quedan muy atrás saltan delante.
  const carZ = coche.position.z;

  environmentObjects.forEach((object) => {
    if (object.position.z > carZ + 300) {
      object.position.z = carZ - randomRange(90, 330);
    } else if (object.position.z < carZ - 420) {
      object.position.z = carZ + randomRange(90, 330);
    }
  });

  mountainObjects.forEach((mountain) => {
    if (mountain.position.z > carZ + 520) {
      mountain.position.z = carZ - randomRange(180, 620);
    } else if (mountain.position.z < carZ - 720) {
      mountain.position.z = carZ + randomRange(180, 620);
    }
  });
}

function updateCamera(delta) {
  if (!coche) {
    return;
  }

  const forward = getCarForwardVector();
  const backward = forward.clone().multiplyScalar(-1);

  const idealPosition = coche.position
    .clone()
    .addScaledVector(backward, CAMERA_DISTANCE_BEHIND);
  idealPosition.y += CAMERA_HEIGHT;

  const lerp = 1 - Math.exp(-CAMERA_SMOOTHING * delta);
  camera.position.lerp(idealPosition, lerp);

  const lookTarget = coche.position
    .clone()
    .addScaledVector(forward, CAMERA_LOOK_AHEAD);
  lookTarget.y += 1.35;

  camera.lookAt(lookTarget);
}

// -----------------------------------------------------------------------------
// Colisiones fiables coche-rana
// -----------------------------------------------------------------------------

function updateCollisions() {
  if (!coche || ranasActivas.length === 0) {
    return;
  }

  const carBox = getCarCollisionBox();

  if (!carBox) {
    return;
  }

  for (let index = ranasActivas.length - 1; index >= 0; index -= 1) {
    const frogData = ranasActivas[index];
    const frogBox = getFrogCollisionBox(frogData.group);

    if (frogBox && carBox.intersectsBox(frogBox)) {
      puntuacion += HIT_SCORE;
      updateScoreHud();
      removeFrogAt(index);
    }
  }
}

function getCarCollisionBox() {
  if (!coche) {
    return null;
  }

  const forward = getCarForwardVector();
  const right = getCarRightVector();
  const center = coche.position.clone();
  center.y += 0.82;

  const halfLength = 2.35;
  const halfWidth = 1.08;
  const halfHeight = 0.78;

  const size = right.clone()
    .multiplyScalar(halfWidth)
    .add(forward.clone().multiplyScalar(halfLength))
    .add(new THREE.Vector3(0, halfHeight, 0))
    .multiplyScalar(2);

  return new THREE.Box3().setFromCenterAndSize(center, size);
}

function getFrogCollisionBox(frogGroup) {
  const center = frogGroup.position.clone();
  center.y += 0.72;

  const radius = 0.72;
  const height = 1.35;

  return new THREE.Box3().setFromCenterAndSize(
    center,
    new THREE.Vector3(radius * 2, height, radius * 2),
  );
}

function keepCarInsideRoadWidth() {
  const roadMargin = 1.7;
  const minX = -ROAD_HALF_WIDTH + roadMargin;
  const maxX = ROAD_HALF_WIDTH - roadMargin;

  coche.position.x = clamp(coche.position.x, minX, maxX);

  // No bloqueamos Z: la carretera se genera de forma infinita.
}

// -----------------------------------------------------------------------------
// Utilidades geométricas
// -----------------------------------------------------------------------------

function getCarForwardVector() {
  return new THREE.Vector3(Math.sin(coche.rotation.y), 0, Math.cos(coche.rotation.y));
}

function getCarRightVector() {
  return new THREE.Vector3(Math.cos(coche.rotation.y), 0, -Math.sin(coche.rotation.y));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function damp(current, target, lambda, deltaTime) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * deltaTime));
}

function randomSignedRange(min, max) {
  const value = randomRange(min, max);
  return Math.random() < 0.5 ? -value : value;
}

function randomInt(min, max) {
  return Math.floor(randomRange(min, max + 1));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];

      materials.forEach((material) => {
        if (material.map) {
          material.map.dispose();
        }

        material.dispose();
      });
    }
  });
}

// -----------------------------------------------------------------------------
// UI y reset
// -----------------------------------------------------------------------------

function updateScoreHud() {
  if (scoreValue) {
    scoreValue.textContent = String(puntuacion);
  }
}

function resetGame() {
  puntuacion = 0;
  updateScoreHud();

  ranasActivas.forEach((frogData) => {
    if (frogData.mixer) {
      frogData.mixer.stopAllAction();
    }

    scene.remove(frogData.group);
    disposeObject(frogData.group);
  });
  ranasActivas.length = 0;

  frogSpawnTimer = FROG_SPAWN_INTERVAL;

  if (coche) {
    coche.position.set(0, 0.05, 0);
    coche.rotation.set(0, Math.PI, 0);
    coche.userData.speed = 0;
  }

  if (camera && coche) {
    const forward = getCarForwardVector();
    camera.position.copy(coche.position).addScaledVector(forward.clone().multiplyScalar(-1), CAMERA_DISTANCE_BEHIND);
    camera.position.y += CAMERA_HEIGHT;
    camera.lookAt(coche.position.clone().addScaledVector(forward, CAMERA_LOOK_AHEAD));
  }

  // Primera oleada inmediata para que la carretera no empiece vacía.
  spawnFrogWave();

  uiOverlay.classList.remove('visible');
  uiOverlay.classList.add('hidden');
  endTitle.textContent = 'VICTORIA';
  endMessage.textContent = 'Modo arcade salvaje: muchas ranas, mapa infinito y colisiones afinadas.';
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
