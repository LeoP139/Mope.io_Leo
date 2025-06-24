const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const CONFIG = {
  MAX_HP: 100,
  ARENA_RADIUS: 290,
  SPRINT_CD: 3000,
  SPRINT_DUR: 1000,
  PLAYER_SIZE: 50,
  MOUTH_DISTANCE: 35,
  BITE_COOLDOWN: 1500,
  BITE_DISTANCE: 50,
  BITE_DAMAGE: 25,
  RESPAWN_TIME: 3000
};

let state = {
  players: {},
  gameActive: true
};

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.x = Math.random() * 500 + 150;
    this.y = Math.random() * 400 + 100;
    this.angle = 0;
    this.hp = CONFIG.MAX_HP;
    this.canBite = true;
    this.lastBite = 0;
    this.lastSprint = 0;
    this.dead = false;
    this.respawnTime = 0;
  }

  updatePosition(x, y, angle, lastSprint) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    if (lastSprint) {
      this.lastSprint = lastSprint;
    }
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      this.respawnTime = Date.now() + CONFIG.RESPAWN_TIME;
    }
    return this.hp <= 0;
  }

  respawn() {
    this.hp = CONFIG.MAX_HP;
    this.dead = false;
    this.x = Math.random() * 500 + 150;
    this.y = Math.random() * 400 + 100;
    this.angle = 0;
  }

  canPerformBite() {
    if (this.dead || !this.canBite) return false;
    const now = Date.now();
    if (now - this.lastBite < CONFIG.BITE_COOLDOWN) return false;
    this.lastBite = now;
    this.canBite = false;
    setTimeout(() => {
      this.canBite = true;
    }, CONFIG.BITE_COOLDOWN);
    return true;
  }
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Nuevo jugador conectado:', socket.id);

  if (Object.keys(state.players).length >= 2) {
    socket.emit('gameFull');
    socket.disconnect();
    return;
  }

  const playerName = `Jugador_${Object.keys(state.players).length + 1}`;
  state.players[socket.id] = new Player(socket.id, playerName);

  socket.emit('init', {
    id: socket.id,
    config: CONFIG,
    state: {
      players: Object.values(state.players),
      gameActive: state.gameActive
    }
  });

  socket.broadcast.emit('playerJoined', state.players[socket.id]);

  socket.on('move', (data) => {
    if (state.players[socket.id]) {
      state.players[socket.id].updatePosition(data.x, data.y, data.angle, data.lastSprint);
    }
  });

  socket.on('bite', () => {
    const player = state.players[socket.id];
    if (!player || !player.canPerformBite()) return;

    let hit = false;
    Object.keys(state.players).forEach(id => {
      if (id === socket.id) return;
      const target = state.players[id];
      if (target.dead) return;

      const mouthX = player.x + Math.cos(player.angle) * CONFIG.MOUTH_DISTANCE;
      const mouthY = player.y + Math.sin(player.angle) * CONFIG.MOUTH_DISTANCE;

      const distance = Math.sqrt((mouthX - target.x)**2 + (mouthY - target.y)**2);
      if (distance < CONFIG.BITE_DISTANCE) {
        target.takeDamage(CONFIG.BITE_DAMAGE);
        hit = true;
      }
    });

    if (hit) {
      checkGameState();
    }
  });

  socket.on('reset', () => {
    resetGame();
  });

  socket.on('disconnect', () => {
    console.log('Jugador desconectado:', socket.id);
    delete state.players[socket.id];
  });
});

function checkGameState() {
  let alivePlayers = 0;
  let winner = null;
  Object.values(state.players).forEach(player => {
    if (!player.dead) {
      alivePlayers++;
      winner = player;
    }
  });

  if (alivePlayers <= 1) {
    state.gameActive = false;
    io.emit('gameOver', { winner });
  }
}

function resetGame() {
  Object.values(state.players).forEach(player => {
    player.hp = CONFIG.MAX_HP;
    player.dead = false;
    player.x = Math.random() * 500 + 150;
    player.y = Math.random() * 400 + 100;
  });
  state.gameActive = true;
  io.emit('state', { players: Object.values(state.players), gameActive: true });
}

setInterval(() => {
  Object.values(state.players).forEach(player => {
    if (player.dead && Date.now() > player.respawnTime) {
      player.respawn();
    }
  });

  io.emit('state', { players: Object.values(state.players), gameActive: state.gameActive });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});