import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Reverse Frogger
 * El jugador conduce hacia la rana. Si la atropella gana; si la rana cruza la carretera, pierde.
 */

// Escala global de los modelos GLB. Ajústalas si el coche o la rana se ven demasiado grandes/pequeños.
const CAR_SCALE = 0.12;
const FROG_SCALE = 0.55;

// Rutas reales detectadas en la carpeta assets. Si renombras los archivos, actualiza estas constantes.
const CAR_MODEL_URL = 'assets/vehicle_-_dodge_viper.glb';
const FROG_MODEL_URL = 'assets/frog_jump.glb';

// Ajuste de orientación del modelo del coche. Si el coche avanza visualmente hacia atrás, prueba con 0 o Math.PI.
const CAR_MODEL_ROTATION_Y = Math.PI;
const FROG_MODEL_ROTATION_Y = 0;

// Configuración de carretera y carriles.
const LANE_COUNT = 4;
const LANE_WIDTH = 4.8;
const ROAD_WIDTH = LANE_COUNT * LANE_WIDTH;
const ROAD_LENGTH = 320;
const ROAD_START_Z = -150;
const ROAD_END_Z = 150;

// Configuración de conducción.
const CAR_BASE_SPEED = 18;
const CAR_TURBO_SPEED = 34;
const CAR_BRAKE_SPEED = 8;
const LANE_CHANGE_SPEED = 3.4;
const LANE_CHANGE_LERP = 8.5;
const MIN_LANE = -(LANE_COUNT - 1) / 2;
const MAX_LANE = (LANE_COUNT - 1) / 2;

// Configuración de la IA de la rana.
const FROG_START_Z = 38;
const FROG_WIN_Z = ROAD_END_Z - 18;
const FROG_STEP_DISTANCE = 8.5;
const FROG_STEP_DURATION = 0.58;
const FROG_HOP_HEIGHT = 1.25;

const GameState = Object.freeze({
  PLAYING: 'playing',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
});

const container = document.getElementById('gameContainer');
const uiOverlay = document.getElementById('uiOverlay');
const endKicker = document.getElementById('endKicker');
const endTitle = document.getElementById('endTitle');
const endMessage = document.getElementById('endMessage');
const restartButton = document.getElementById('restartButton');

let scene;
let camera;
let renderer;
let clock;

let playerCar;
let frog;
let frogMixer;
let frogJumpAction;
let frogHop = null;

let gameState = GameState.PLAYING;
let carTargetLane = 0;
let frogLane = 0;
let frogStepTimer = 0;
let nextFrogDelay = randomRange(0.45, 0.85);
let frogBackCooldown = 0;

const keys = new Set();
const controlCodes = new Set([
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

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07111f);
  scene.fog = new THREE.Fog(0x07111f, 70, 240);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);

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

  createLights();
  createWorld();
  createActors();
  setupInput();
  loadCarModel();
  loadFrogModel();

  restartButton.addEventListener('click', resetGame);
  window.addEventListener('resize', onWindowResize);

  resetGame();
  animate();
}

function createLights() {
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.46);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.25);
  directionalLight.position.set(-10, 22, 12);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(2048, 2048);
  directionalLight.shadow.camera.near = 1;
  directionalLight.shadow.camera.far = 80;
  directionalLight.shadow.camera.left = -35;
  directionalLight.shadow.camera.right = 35;
  directionalLight.shadow.camera.top = 35;
  directionalLight.shadow.camera.bottom = -35;
  scene.add(directionalLight);

  const fillLight = new THREE.HemisphereLight(0x93c5fd, 0x111827, 0.35);
  scene.add(fillLight);
}

function createWorld() {
  const roadGroup = new THREE.Group();
  roadGroup.name = 'Carretera y decoracion';
  scene.add(roadGroup);

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2f36,
    roughness: 0.92,
    metalness: 0.02,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.z = (ROAD_START_Z + ROAD_END_Z) / 2;
  road.receiveShadow = true;
  roadGroup.add(road);

  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x12351f,
    roughness: 1,
    metalness: 0,
  });
  const leftGrass = new THREE.Mesh(new THREE.PlaneGeometry(160, ROAD_LENGTH), grassMaterial);
  leftGrass.rotation.x = -Math.PI / 2;
  leftGrass.position.set(-ROAD_WIDTH / 2 - 80, -0.02, (ROAD_START_Z + ROAD_END_Z) / 2);
  leftGrass.receiveShadow = true;
  roadGroup.add(leftGrass);

  const rightGrass = leftGrass.clone();
  rightGrass.position.x = ROAD_WIDTH / 2 + 80;
  roadGroup.add(rightGrass);

  createLaneMarkings(roadGroup);
  createRoadProps(roadGroup);
}

function createLaneMarkings(group) {
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    transparent: true,
    opacity: 0.82,
  });
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: 0xe5e7eb,
    transparent: true,
    opacity: 0.9,
  });

  for (let lane = 1; lane < LANE_COUNT; lane += 1) {
    const x = -ROAD_WIDTH / 2 + lane * LANE_WIDTH;
    for (let z = ROAD_START_Z + 10; z < ROAD_END_Z - 8; z += 16) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.035, 8), lineMaterial.clone());
      dash.position.set(x, 0.035, z);
      group.add(dash);
    }
  }

  [-ROAD_WIDTH / 2, ROAD_WIDTH / 2].forEach((x) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, ROAD_LENGTH - 8), edgeMaterial);
    edge.position.set(x, 0.045, (ROAD_START_Z + ROAD_END_Z) / 2);
    group.add(edge);
  });
}

function createRoadProps(group) {
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.75,
    metalness: 0.08,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.25,
  });
  const coneMaterial = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.65,
    metalness: 0.02,
  });

  [-ROAD_WIDTH / 2 - 1.1, ROAD_WIDTH / 2 + 1.1].forEach((x) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, ROAD_LENGTH - 12), railMaterial);
    rail.position.set(x, 0.65, (ROAD_START_Z + ROAD_END_Z) / 2);
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);

    for (let z = ROAD_START_Z + 18; z < ROAD_END_Z - 18; z += 18) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.55), barrierMaterial);
      post.position.set(x, 0.38, z);
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);
    }
  });

  for (let z = ROAD_START_Z + 24; z < ROAD_END_Z - 24; z += 32) {
    [-1, 1].forEach((side) => {
      const x = side * (ROAD_WIDTH / 2 + 5.5);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 12), barrierMaterial);
      pole.position.set(x, 2.6, z);
      pole.castShadow = true;
      group.add(pole);

      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshStandardMaterial({
        color: 0xfef3c7,
        emissive: 0xfbbf24,
        emissiveIntensity: 0.85,
        roughness: 0.35,
      }));
      lamp.position.set(x, 5.25, z);
      group.add(lamp);
    });

    [-ROAD_WIDTH / 2 - 0.65, ROAD_WIDTH / 2 + 0.65].forEach((x) => {
      const cone = createTrafficCone(coneMaterial);
      cone.position.set(x, 0, z + 8);
      group.add(cone);
    });
  }
}

function createTrafficCone(material) {
  const cone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 18), material);
  body.position.y = 0.58;
  body.castShadow = true;
  body.receiveShadow = true;
  cone.add(body);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.16, 18), material);
  base.position.y = 0.08;
  base.castShadow = true;
  base.receiveShadow = true;
  cone.add(base);

  return cone;
}

function createActors() {
  playerCar = new THREE.Group();
  playerCar.name = 'Coche del jugador';
  playerCar.userData.speed = CAR_BASE_SPEED;
  scene.add(playerCar);

  frog = new THREE.Group();
  frog.name = 'Rana IA';
  scene.add(frog);
}

function loadCarModel() {
  const loader = new GLTFLoader();

  loader.load(
    CAR_MODEL_URL,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      installModel(model, playerCar, CAR_SCALE, CAR_MODEL_ROTATION_Y);
    },
    undefined,
    (error) => {
      console.warn('No se pudo cargar el coche GLB. Usando modelo fallback.', error);
      installModel(createFallbackCar(), playerCar, 1, 0);
    },
  );
}

function loadFrogModel() {
  const loader = new GLTFLoader();

  loader.load(
    FROG_MODEL_URL,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      installModel(model, frog, FROG_SCALE, FROG_MODEL_ROTATION_Y);

      if (gltf.animations && gltf.animations.length > 0) {
        frogMixer = new THREE.AnimationMixer(model);
        frogJumpAction = frogMixer.clipAction(gltf.animations[0]);
        frogJumpAction.clampWhenFinished = true;
        frogJumpAction.setLoop(THREE.LoopOnce, 1);
      }
    },
    undefined,
    (error) => {
      console.warn('No se pudo cargar la rana GLB. Usando modelo fallback.', error);
      installModel(createFallbackFrog(), frog, 1, 0);
    },
  );
}

function installModel(model, parent, scale, rotationY) {
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

  const body = new THREE.Mesh(new THREE.BoxGeometry(15, 4.8, 30), bodyMaterial);
  body.position.y = 2.6;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(10.5, 4.2, 11), glassMaterial);
  cabin.position.set(0, 6.4, -3);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelGeometry = new THREE.CylinderGeometry(2.1, 2.1, 1.5, 24);
  [-1, 1].forEach((side) => {
    [-9, 9].forEach((z) => {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 5.6, 1.7, z);
      wheel.castShadow = true;
      group.add(wheel);
    });
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfbbf24,
    emissiveIntensity: 1.2,
  });
  [-2.4, 2.4].forEach((x) => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 0.35), headlightMaterial);
    light.position.set(x, 3.0, 15.15);
    group.add(light);
  });

  return group;
}

function createFallbackFrog() {
  const group = new THREE.Group();
  const greenMaterial = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    roughness: 0.72,
    metalness: 0.02,
  });
  const lightGreenMaterial = new THREE.MeshStandardMaterial({
    color: 0x86efac,
    roughness: 0.72,
    metalness: 0.02,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
  });
  const pupilMaterial = new THREE.MeshStandardMaterial({
    color: 0x020617,
    roughness: 0.2,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16), greenMaterial);
  body.scale.set(1, 0.82, 1.15);
  body.position.y = 2.5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(2.45, 24, 16), greenMaterial);
  head.position.set(0, 4.65, 1.35);
  head.castShadow = true;
  group.add(head);

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), eyeMaterial);
    eye.position.set(side * 0.9, 5.55, 1.85);
    eye.castShadow = true;
    group.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), pupilMaterial);
    pupil.position.set(side * 0.9, 5.55, 2.38);
    group.add(pupil);
  });

  const legGeometry = new THREE.SphereGeometry(1.05, 18, 12);
  [-1, 1].forEach((side) => {
    [-1, 1].forEach((front) => {
      const leg = new THREE.Mesh(legGeometry, lightGreenMaterial);
      leg.scale.set(1.35, 0.65, 0.8);
      leg.position.set(side * 1.65, 1.35, front * 1.75);
      leg.castShadow = true;
      group.add(leg);
    });
  });

  return group;
}

function setupInput() {
  window.addEventListener('keydown', (event) => {
    if (controlCodes.has(event.code)) {
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
  return Number(right) - Number(left);
}

function getThrottleInput() {
  return keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
}

function getBrakeInput() {
  return keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
}

function updateCar(delta) {
  if (!playerCar) {
    return;
  }

  const steer = getSteerInput();
  const throttle = getThrottleInput();
  const brake = getBrakeInput();

  const desiredSpeed = CAR_BASE_SPEED
    + throttle * (CAR_TURBO_SPEED - CAR_BASE_SPEED)
    - brake * (CAR_BASE_SPEED - CAR_BRAKE_SPEED);

  playerCar.userData.speed = THREE.MathUtils.damp(
    playerCar.userData.speed,
    desiredSpeed,
    brake ? 9 : 4.2,
    delta,
  );

  carTargetLane = THREE.MathUtils.clamp(
    carTargetLane + steer * LANE_CHANGE_SPEED * delta,
    MIN_LANE,
    MAX_LANE,
  );

  const targetX = carTargetLane * LANE_WIDTH;
  const laneLerp = Math.min(1, LANE_CHANGE_LERP * delta);
  playerCar.position.x += (targetX - playerCar.position.x) * laneLerp;

  const laneDrift = (targetX - playerCar.position.x) / LANE_WIDTH;
  playerCar.rotation.y = THREE.MathUtils.damp(
    playerCar.rotation.y,
    -steer * 0.16 - laneDrift * 0.08,
    8,
    delta,
  );

  playerCar.position.z += playerCar.userData.speed * delta;

  // Evita que el coche salga visualmente del tramo de carretera generado.
  if (playerCar.position.z > ROAD_END_Z - 28) {
    playerCar.position.z = ROAD_END_Z - 28;
    playerCar.userData.speed = Math.min(playerCar.userData.speed, 4);
  }
}

function updateFrogAI(delta) {
  if (!frog) {
    return;
  }

  updateFrogHop(delta);

  const sameLane = Math.abs(frogLane - playerCar.position.x / LANE_WIDTH) < 0.78;
  const distanceZ = playerCar.position.z - frog.position.z;
  const carIsApproaching = distanceZ < 20 && distanceZ > -7 && playerCar.userData.speed > 13;
  const danger = sameLane && carIsApproaching;
  const immediateDanger = sameLane && distanceZ < 9 && distanceZ > -3 && playerCar.userData.speed > 18;

  if (danger) {
    // Si el coche viene rápido por este carril, la rana duda o salta hacia atrás.
    frogStepTimer = Math.max(frogStepTimer, 0.52);

    if (immediateDanger && frogBackCooldown <= 0 && frog.position.z > FROG_START_Z - 10) {
      const saferLane = chooseFrogLane(true);
      startFrogJump(saferLane, frog.position.z - FROG_STEP_DISTANCE * 0.75);
      frogBackCooldown = 1.25;
      return;
    }

    return;
  }

  // Si el carril está libre, acelera su ritmo de salto hacia la meta.
  frogStepTimer += delta * (playerCar.userData.speed > 26 ? 0.45 : 1);

  if (frogStepTimer >= nextFrogDelay) {
    const targetLane = chooseFrogLane(false);
    startFrogJump(targetLane, frog.position.z + FROG_STEP_DISTANCE);
    frogStepTimer = 0;
    nextFrogDelay = randomRange(0.46, 0.88);
  }

  frogBackCooldown = Math.max(0, frogBackCooldown - delta);
}

function chooseFrogLane(forceAvoidCar) {
  const candidates = [frogLane, frogLane - 1, frogLane + 1]
    .filter((lane) => lane >= MIN_LANE && lane <= MAX_LANE)
    .map((lane) => ({
      lane,
      risk: getLaneRisk(lane),
      noise: Math.random() * 0.25,
    }))
    .sort((a, b) => {
      const penaltyA = forceAvoidCar && a.lane === Math.round(playerCar.position.x / LANE_WIDTH) ? 2 : 0;
      const penaltyB = forceAvoidCar && b.lane === Math.round(playerCar.position.x / LANE_WIDTH) ? 2 : 0;
      return a.risk + penaltyA + a.noise - (b.risk + penaltyB + b.noise);
    });

  return candidates[0]?.lane ?? frogLane;
}

function getLaneRisk(laneIndex) {
  const carLane = playerCar.position.x / LANE_WIDTH;
  const laneDistance = Math.abs(laneIndex - carLane);
  const distanceZ = playerCar.position.z - frog.position.z;
  let risk = laneDistance * 1.8;

  // Penaliza carriles donde el coche está cerca y avanzando rápido.
  if (laneDistance < 0.82 && distanceZ < 24 && distanceZ > -8) {
    risk += 7 + playerCar.userData.speed / 5;
  }

  // Penaliza mucho el carril exacto del coche si está a punto de pasar por la rana.
  if (laneDistance < 0.35 && distanceZ < 10 && distanceZ > -4) {
    risk += 18;
  }

  return risk;
}

function startFrogJump(targetLane, targetZ) {
  if (!frog) {
    return;
  }

  const now = performance.now() / 1000;
  frogHop = {
    from: frog.position.clone(),
    to: new THREE.Vector3(targetLane * LANE_WIDTH, 0, targetZ),
    start: now,
    duration: FROG_STEP_DURATION,
  };

  frogLane = targetLane;

  if (frogJumpAction) {
    frogJumpAction.reset();
    frogJumpAction.clampWhenFinished = true;
    frogJumpAction.setEffectiveTimeScale(1.25);
    frogJumpAction.play();
  }
}

function updateFrogHop(delta) {
  if (!frog || !frogHop) {
    if (frog) {
      frog.position.y = 0;
    }
    return;
  }

  const now = performance.now() / 1000;
  const t = THREE.MathUtils.clamp((now - frogHop.start) / frogHop.duration, 0, 1);
  const eased = smoothstep(t);

  frog.position.lerpVectors(frogHop.from, frogHop.to, eased);
  frog.position.y = Math.sin(Math.PI * t) * FROG_HOP_HEIGHT;

  if (t >= 1) {
    frogHop = null;
    frog.position.y = 0;
  }
}

function updateCamera(delta) {
  if (!playerCar) {
    return;
  }

  const carPosition = playerCar.position;
  const idealPosition = new THREE.Vector3(
    carPosition.x * 0.58,
    carPosition.y + 5.4,
    carPosition.z - 10.5,
  );

  const cameraLerp = 1 - Math.exp(-6.5 * delta);
  camera.position.lerp(idealPosition, cameraLerp);

  const lookTarget = new THREE.Vector3(
    carPosition.x * 0.35,
    carPosition.y + 1.2,
    carPosition.z + 16,
  );
  camera.lookAt(lookTarget);
}

function updateCollisions() {
  if (!playerCar || !frog) {
    return;
  }

  const carBox = getCollisionBox(playerCar, 0.72);
  const frogBox = getCollisionBox(frog, 0.72);

  if (carBox.intersectsBox(frogBox)) {
    endGame(GameState.VICTORY);
    return;
  }

  if (frog.position.z >= FROG_WIN_Z) {
    endGame(GameState.DEFEAT);
  }
}

function getCollisionBox(root, scale) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(scale);

  return new THREE.Box3(
    center.clone().addScaledVector(size, -0.5),
    center.clone().addScaledVector(size, 0.5),
  );
}

function endGame(result) {
  if (gameState !== GameState.PLAYING) {
    return;
  }

  gameState = result;

  if (result === GameState.VICTORY) {
    endKicker.textContent = 'Reverse Frogger';
    endTitle.textContent = 'VICTORIA';
    endMessage.textContent = 'Atropellaste a la rana antes de que cruzara la carretera.';
  } else {
    endKicker.textContent = 'Reverse Frogger';
    endTitle.textContent = 'DERROTA';
    endMessage.textContent = 'La rana llegó sana y salva al otro lado de la carretera.';
  }

  uiOverlay.classList.remove('hidden');
  uiOverlay.classList.add('visible');
}

function resetGame() {
  gameState = GameState.PLAYING;

  uiOverlay.classList.remove('visible');
  uiOverlay.classList.add('hidden');

  carTargetLane = 0;
  frogLane = 0;
  frogStepTimer = 0;
  nextFrogDelay = randomRange(0.45, 0.85);
  frogBackCooldown = 0;
  frogHop = null;

  if (playerCar) {
    playerCar.position.set(0, 0.05, -58);
    playerCar.rotation.set(0, CAR_MODEL_ROTATION_Y, 0);
    playerCar.userData.speed = CAR_BASE_SPEED;
  }

  if (frog) {
    frog.position.set(0, 0.05, FROG_START_Z);
    frog.rotation.set(0, FROG_MODEL_ROTATION_Y, 0);
  }

  if (frogJumpAction) {
    frogJumpAction.stop();
    frogJumpAction.reset();
  }

  if (camera) {
    camera.position.set(0, 6, -68);
  }
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.033);

  if (gameState === GameState.PLAYING) {
    updateCar(delta);
    updateFrogAI(delta);
  } else if (frogMixer) {
    frogMixer.update(delta);
  }

  if (frogMixer) {
    frogMixer.update(delta);
  }

  updateCamera(delta);
  updateCollisions();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
