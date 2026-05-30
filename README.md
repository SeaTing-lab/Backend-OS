# Smart Home Backend
### ESP32 IoT Backend — REST API + MQTT Bridge + WebSocket + SQLite

---

## Architecture

```
Phone (Flutter App)
    │
    ├── REST API  (HTTP)  ──► Express.js :3000/api
    ├── WebSocket (WS)    ──► ws://server:3000/ws   (real-time updates)
    │
    └── MQTT (optional direct) ─┐
                                │
ESP32 DEV KIT V4 ──── MQTT ───► Mosquitto Broker :1883
                                │
                         Backend MQTT Bridge
                                │
                         ┌──────┴──────┐
                         │   Prisma    │
                         │   SQLite    │
                         └─────────────┘
```

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Copy env
cp .env.example .env
# Edit .env: set JWT_SECRET, MQTT_HOST

# 3. Setup database
npx prisma migrate dev --name init
node prisma/seed.js

# 4. Run (dev)
npm run dev

# 5. Run (production with Docker)
docker-compose up -d
```

Default admin credentials (from seed):
- Email: `admin@smarthome.local`
- Password: `admin123`

---

## API Reference

### Auth

| Method | Endpoint | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password, name?}` | Register new user |
| POST | `/api/auth/login` | `{email, password}` | Get JWT token |
| PUT  | `/api/auth/fcm-token` | `{userId, token}` | Save FCM push token |

All other endpoints require `Authorization: Bearer <token>` header.

---

### Sensors

| Method | Endpoint | Query | Description |
|---|---|---|---|
| GET | `/api/sensors/latest` | — | Most recent sensor reading |
| GET | `/api/sensors/history` | `limit, from, to` | Time-series readings |
| GET | `/api/sensors/stats` | `hours` | Min/max/avg stats |
| DELETE | `/api/sensors/old` | `days` | Delete readings older than N days |

**GET /api/sensors/latest** response:
```json
{
  "id": 42,
  "temperature": 28.3,
  "humidity": 65.0,
  "gasLevel": 180,
  "isRaining": false,
  "distance": 210.5,
  "doorOpen": false,
  "createdAt": "2025-04-12T10:30:00Z"
}
```

**GET /api/sensors/stats?hours=24** response:
```json
{
  "period": "24h",
  "count": 2880,
  "temperature": { "min": 24.1, "max": 36.8, "avg": 28.5 },
  "gasLevel":    { "min": 120,  "max": 450,  "avg": 195.3 },
  "distance":    { "min": 45.0, "max": 350.0,"avg": 210.1 }
}
```

---

### Devices

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/devices` | — | All devices + state |
| GET | `/api/devices/:id` | — | Single device |
| PATCH | `/api/devices/:id` | `{isOn: bool}` | Toggle relay/actuator |
| POST | `/api/devices/all-off` | — | Turn off all relays |
| POST | `/api/devices/all-on` | — | Turn on all relays |

**PATCH /api/devices/relay_1** body + response:
```json
// Request:
{ "isOn": true }

// Response:
{ "id": "relay_1", "name": "DC Fan", "isOn": true, "mqtt": "sent" }
```

Device IDs: `relay_1`, `relay_2`, `relay_3`, `relay_4`, `buzzer`, `servo`, `camera`

---

### Alerts

| Method | Endpoint | Query/Body | Description |
|---|---|---|---|
| GET | `/api/alerts` | `page, limit, unread` | Paginated alert history |
| GET | `/api/alerts/unread-count` | — | Badge count |
| PATCH | `/api/alerts/:id/read` | — | Mark one read |
| POST | `/api/alerts/mark-all-read` | — | Mark all read |
| GET | `/api/alerts/thresholds` | — | Get sensor thresholds |
| PUT | `/api/alerts/thresholds` | `{temperatureMax, gasLevelMax, ultrasonicMin}` | Update thresholds |

---

### System

| Method | Endpoint | Body | Description |
|---|---|---|---|
| GET | `/api/system/status` | — | ESP32 online, MQTT status, WS clients |
| PATCH | `/api/system/mode` | `{mode}` | Set manual/automatic/google |

**GET /api/system/status** response:
```json
{
  "id": 1,
  "mode": "manual",
  "esp32Online": true,
  "mqttConnected": true,
  "wsClients": 2,
  "updatedAt": "2025-04-12T10:30:00Z"
}
```

---

## WebSocket Events

Connect to `ws://localhost:3000/ws`

All messages are JSON: `{ "type": "...", "data": {...} }`

| Type | Direction | Description |
|---|---|---|
| `connected` | Server → Client | Sent on connect |
| `sensor_update` | Server → Client | New sensor reading (every 3s) |
| `alert` | Server → Client | New threshold alert |
| `device_update` | Server → Client | Relay/actuator state changed |
| `esp32_status` | Server → Client | ESP32 online/offline |
| `mode_change` | Server → Client | Control mode changed |
| `all_off` / `all_on` | Server → Client | Bulk relay command result |
| `ping` | Client → Server | Keep-alive |
| `pong` | Server → Client | Response to ping |

**Flutter WebSocket example:**
```dart
final channel = WebSocketChannel.connect(Uri.parse('ws://192.168.1.100:3000/ws'));
channel.stream.listen((msg) {
  final data = jsonDecode(msg);
  if (data['type'] == 'sensor_update') {
    final sensors = SensorData.fromJson(data['data']);
    // update state
  } else if (data['type'] == 'alert') {
    // show notification
  }
});
```

---

## MQTT Topics (ESP32 ↔ Backend)

| Topic | Direction | Payload |
|---|---|---|
| `esp32/sensors` | ESP32 → Backend | `{temperature, humidity, gas_level, rain, ultrasonic, door_open}` |
| `relay/1..4` | Backend → ESP32 | `{"state": "ON"}` |
| `actuator/buzzer` | Backend → ESP32 | `{"state": "ON"}` |
| `actuator/servo` | Backend → ESP32 | `{"state": "ON"}` |
| `actuator/camera` | Backend → ESP32 | `{"state": "ON"}` |
| `esp32/mode` | Backend → ESP32 | `{"mode": "automatic"}` |
| `smart_home/status` | ESP32 → Backend | `"online"` / `"offline"` (LWT) |
| `backend/status` | Backend → MQTT | `{"online": true}` |

---

## Cron Jobs

| Schedule | Job |
|---|---|
| Every day at 2am | Delete sensor readings older than 30 days |
| Every Sunday at 3am | Delete alerts older than 90 days |
| Every day at midnight | Auto mode: turn off all lights |
| Every day at 6pm | Auto mode: turn on main lights |
| Every 30 seconds | ESP32 watchdog (mark offline if no reading) |

---

## Project Structure

```
smart_home_backend/
├── src/
│   ├── index.js                  # Express + HTTP server + boot
│   ├── config/
│   │   └── logger.js             # Winston logger
│   ├── middleware/
│   │   └── auth.js               # JWT guard
│   ├── routes/
│   │   ├── auth.js               # POST /api/auth/*
│   │   ├── sensors.js            # GET  /api/sensors/*
│   │   ├── devices.js            # PATCH /api/devices/*
│   │   ├── alerts.js             # GET  /api/alerts/*
│   │   └── system.js             # GET  /api/system/*
│   └── services/
│       ├── mqttService.js        # MQTT client + ESP32 bridge
│       ├── wsService.js          # WebSocket server
│       ├── alertService.js       # Threshold checks + push
│       └── cronService.js        # Scheduled jobs
├── prisma/
│   ├── schema.prisma             # DB models
│   └── seed.js                   # Initial data
├── mosquitto/
│   └── mosquitto.conf            # Broker config
├── docker-compose.yml
├── Dockerfile
└── .env.example
```