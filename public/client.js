const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const sprite = new Image();
sprite.src = 'skins/player.png';

// Elementos de UI
const cooldownIndicator = document.getElementById('cooldown-indicator');
const cooldownText = document.getElementById('cooldown-text');

// Constantes de configuración
const CONFIG = {
  MAX_HP: 100,
  ARENA_RADIUS: 190,
  SPRINT_CD: 3000,
  SPRINT_DUR: 1000,
  BASE_SPEED: 1.8,        // Velocidad base reducida para mejor control
  ACCELERATION: 0.15,     // Aceleración para movimiento suave
  FRICTION: 0.92,         // Fricción para detener gradualmente
  MAX_VELOCITY: 5.0,      // Velocidad máxima
  SPRINT_MULT: 1.8,       // Multiplicador de sprint
  BITE_COOLDOWN: 1500,
  PLAYER_SIZE: 40,
  MOUTH_DISTANCE: 25      // Distancia de la boca desde el centro
};

let mouse = { x: 200, y: 200 };
let down = false;
let state = { players: [], biteCount: 0, gameActive: true };
let myId = null;
let lastRender = 0;
const FPS = 60;
const FRAME_TIME = 1000 / FPS;

// Variables para movimiento fluido
let velocity = { x: 0, y: 0 };
let isMoving = false;

// Configuración de eventos
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});

canvas.addEventListener('mousedown', () => {
  down = true;
  isMoving = true;
});

canvas.addEventListener('mouseup', () => {
  down = false;
});

canvas.addEventListener('mouseleave', () => {
  isMoving = false;
});

canvas.addEventListener('click', () => {
  // Enviar evento de mordida si el juego está activo
  if (state.gameActive) {
    socket.emit('bite');
  }
  // Reiniciar el juego al hacer click cuando termina
  else {
    socket.emit('reset');
  }
});

// Depuración de conexión
socket.on('connect', () => {
  console.log('Conectado al servidor con ID:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Desconectado del servidor');
});

socket.on('connect_error', (err) => {
  console.error('Error de conexión:', err.message);
});

socket.on('state', (newState) => {
  state = newState;
  if (!myId) {
    myId = socket.id;
    console.log('Mi ID:', myId);
  }
  
  // Actualizar indicador de cooldown
  updateCooldownIndicator();
});

// Actualizar indicador de cooldown
function updateCooldownIndicator() {
  if (!myId) return;
  
  const player = state.players.find(p => p.id === myId);
  if (!player) return;
  
  if (player.canBite) {
    cooldownIndicator.classList.remove('cooldown-active');
    cooldownText.textContent = 'LISTO';
  } else {
    cooldownIndicator.classList.add('cooldown-active');
    const now = Date.now();
    const elapsed = now - (player.lastBite || now);
    const remaining = Math.max(0, Math.ceil((CONFIG.BITE_COOLDOWN - elapsed) / 1000));
    
    if (isNaN(remaining)) {
      cooldownText.textContent = '0s';
    } else {
      cooldownText.textContent = `${remaining}s`;
    }
  }
}

// Función para mover al jugador con movimiento fluido
const movePlayer = () => {
  if (!myId || !state.gameActive) return;
  
  const player = state.players.find(p => p.id === myId);
  if (!player || player.hp <= 0) return;
  
  const now = Date.now();
  
  // Calcular ángulo hacia el ratón
  player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  
  // Cálculo de sprint
  const canSprint = down && now - (player.lastSprint || 0) > CONFIG.SPRINT_CD;
  if (canSprint) {
    player.lastSprint = now;
  }
  
  const isSprinting = now - (player.lastSprint || 0) < CONFIG.SPRINT_DUR;
  const speedMultiplier = isSprinting ? CONFIG.SPRINT_MULT : 1;
  
  // Calcular vector hacia el ratón
  const dx = mouse.x - player.x;
  const dy = mouse.y - player.y;
  const distance = Math.hypot(dx, dy);
  
  // Solo mover si el ratón está lo suficientemente lejos
  if (distance > 5) {
    // Normalizar dirección
    const dirX = dx / distance;
    const dirY = dy / distance;
    
    // Aplicar aceleración
    velocity.x += dirX * CONFIG.ACCELERATION * speedMultiplier;
    velocity.y += dirY * CONFIG.ACCELERATION * speedMultiplier;
    
    // Limitar velocidad máxima
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed > CONFIG.MAX_VELOCITY) {
      velocity.x = (velocity.x / speed) * CONFIG.MAX_VELOCITY;
      velocity.y = (velocity.y / speed) * CONFIG.MAX_VELOCITY;
    }
  } else if (!isMoving) {
    // Aplicar fricción cuando no se está moviendo
    velocity.x *= CONFIG.FRICTION;
    velocity.y *= CONFIG.FRICTION;
    
    // Detener completamente cuando la velocidad es muy baja
    if (Math.abs(velocity.x) < 0.1) velocity.x = 0;
    if (Math.abs(velocity.y) < 0.1) velocity.y = 0;
  }
  
  // Actualizar posición
  player.x += velocity.x;
  player.y += velocity.y;
  
  // Limitar a la arena
  const dist = Math.hypot(player.x - 200, player.y - 200);
  if (dist > CONFIG.ARENA_RADIUS - CONFIG.PLAYER_SIZE/2) {
    const ratio = (CONFIG.ARENA_RADIUS - CONFIG.PLAYER_SIZE/2) / dist;
    player.x = 200 + (player.x - 200) * ratio;
    player.y = 200 + (player.y - 200) * ratio;
    
    // Rebote suave al chocar con el borde
    velocity.x *= -0.5;
    velocity.y *= -0.5;
  }
  
  // Enviar datos al servidor
  socket.emit('move', {
    x: player.x,
    y: player.y,
    angle: player.angle,
    lastSprint: player.lastSprint
  });
};

// Función de dibujo
const draw = () => {
  ctx.clearRect(0, 0, 400, 400);
  
  // Dibujar arena con gradiente
  const gradient = ctx.createRadialGradient(200, 200, 10, 200, 200, CONFIG.ARENA_RADIUS);
  gradient.addColorStop(0, '#2a8c5a');
  gradient.addColorStop(1, '#195a36');
  
  ctx.beginPath();
  ctx.arc(200, 200, CONFIG.ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // UI: Contador de mordidas
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(5, 5, 120, 25);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`Mordidas: ${state.biteCount}`, 10, 22);
  
  // Dibujar jugadores
  state.players.forEach(p => {
    if (!p) return;
    
    // Dibujar sprite o placeholder
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    ctx.translate(p.x, p.y);
    
    // Rotación hacia el ratón
    ctx.rotate(p.angle);
    
    if (sprite.complete && sprite.naturalHeight !== 0) {
      // Personaje principal (más grande)
      const sizeMultiplier = p.id === myId ? 1.2 : 1.0;
      ctx.drawImage(
        sprite, 
        -CONFIG.PLAYER_SIZE * sizeMultiplier, 
        -CONFIG.PLAYER_SIZE * sizeMultiplier, 
        CONFIG.PLAYER_SIZE * 2 * sizeMultiplier, 
        CONFIG.PLAYER_SIZE * 2 * sizeMultiplier
      );
    } else {
      // Placeholder si el sprite no carga
      ctx.fillStyle = p.id === myId ? 'blue' : (p.id === 'BOT' ? 'red' : 'green');
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.PLAYER_SIZE, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
    
    // Dibujar boca
    ctx.fillStyle = p.id === myId ? '#ff5555' : '#ff0000';
    const mouthX = p.x + Math.cos(p.angle) * CONFIG.MOUTH_DISTANCE;
    const mouthY = p.y + Math.sin(p.angle) * CONFIG.MOUTH_DISTANCE;
    ctx.beginPath();
    ctx.arc(mouthX, mouthY, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Nombre del jugador
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - CONFIG.PLAYER_SIZE - 10);
    
    // Barra de vida
    const hpWidth = 60 * (p.hp / CONFIG.MAX_HP);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(p.x - 31, p.y - CONFIG.PLAYER_SIZE - 15, 62, 10);
    ctx.fillStyle = p.hp < 30 ? '#ff5555' : '#55ff55';
    ctx.fillRect(p.x - 30, p.y - CONFIG.PLAYER_SIZE - 14, hpWidth, 8);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(p.x - 30, p.y - CONFIG.PLAYER_SIZE - 14, 60, 8);
    
    // Dibujar indicador de cooldown
    if (!p.canBite) {
      const now = Date.now();
      const lastBite = p.lastBite || 0;
      const cooldownProgress = Math.min(1, (now - lastBite) / CONFIG.BITE_COOLDOWN);
      
      // Arco de cooldown
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONFIG.PLAYER_SIZE + 10, 
             -Math.PI/2, -Math.PI/2 + (Math.PI * 2 * cooldownProgress));
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Efecto de pulsación durante el cooldown
      if (cooldownProgress < 0.8) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, CONFIG.PLAYER_SIZE + 5 + Math.sin(now * 0.02) * 3, 
               0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 50, 50, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    
    // Dibujar área de mordida cuando está lista
    if (p.canBite && p.id === myId) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, CONFIG.PLAYER_SIZE + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 255, 100, 0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  
  // Pantalla de fin de juego
  if (!state.gameActive) {
    const winner = state.players.find(p => p.hp > 0);
    const isWinner = winner && winner.id === myId;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, 400, 400);
    
    ctx.fillStyle = isWinner ? '#55ff55' : '#ff5555';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isWinner ? '¡VICTORIA!' : '¡DERROTA!', 200, 150);
    
    ctx.fillStyle = 'white';
    ctx.font = '20px sans-serif';
    ctx.fillText(`Ganador: ${winner ? winner.name : 'N/A'}`, 200, 190);
    ctx.fillText('Click para reiniciar', 200, 230);
  }
};

// Bucle de renderizado
const render = (timestamp) => {
  requestAnimationFrame(render);
  
  const delta = timestamp - lastRender;
  if (delta < FRAME_TIME) return;
  lastRender = timestamp;
  
  movePlayer();
  draw();
};

// Iniciar bucle de render
requestAnimationFrame(render);