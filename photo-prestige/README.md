# Photo Prestige - Cloud Services Eindopdracht

Een massive multiplayer online fotospeurtocht waar gebruikers targetfoto's uploaden en anderen deze zo goed mogelijk proberen na te maken met automatische scoring via afbeeldingsanalyse.

## 📋 Project Overzicht

**Applicatie:** Photo Prestige - "Dé speurtocht naar die ene foto!"

**Doelstelling:** Een platform waar deelnemers targetfoto's kunnen uploaden en anderen deze kunnen namaken door zoeken naar het exacte camerastandpunt. Het systeem geeft automatisch een matchingscore en bepaalt winnaars.

## 🏗️ Architectuur

Het project is opgebouwd uit meerdere microservices:

```
┌─────────────────────────────────────────────────────┐
│         API Gateway (Express)                       │
└────────────┬────────────────────────────────────────┘
             │
    ┌────────┴──────────┬──────────┬──────────┐
    │                   │          │          │
┌───▼────┐    ┌────────▼──┐  ┌───▼──┐  ┌───▼────┐
│ Auth   │    │ Register  │  │Clock │  │ Target │
│Service │    │ Service   │  │Svc   │  │Service │
└────────┘    └───────────┘  └──────┘  └────────┘
    │                                      │
┌───▼────┐    ┌────────────┐  ┌──────┐  ┌▼──────┐
│ Mail   │    │ Score      │  │ Read │  │Imagga │
│Service │    │ Service    │  │Svc   │  │API    │
└────────┘    └────────────┘  └──────┘  └───────┘
    │                   │         │
    └───────────────────┴─────────┘
              │
        ┌─────▼──────┐
        │ PostgreSQL │
        │ Database   │
        └────────────┘
```

### Services

1. **Auth Service** (Port 3001)
   - JWT-gebaseerde authenticatie
   - Token generatie en validatie
   - User authentication

2. **Register Service** (Port 3002)
   - Gebruiker registratie (Target Owner, Participant)
   - Profiel management
   - Rechten/Rollen beheer

3. **Target Service** (Port 3003)
   - Target foto upload
   - Location beschrijvingen
   - Target metadata opslag (in cloud storage)

4. **Mail Service** (Port 3004)
   - Registratiebevestigingen
   - Score meldingen
   - Reminders voor deelnemers

5. **Clock Service** (Port 3005)
   - Wedstrijdtiming
   - Deadline tracking
   - Auto-notification naar Register service

6. **Score Service** (Port 3006)
   - Imagga API integratie
   - Photo matching scores
   - Score berekeningen met winnaarbepaling

7. **Read Service** (Port 3007)
   - Query interface voor actieve wedstrijden
   - Target overzichten per locatie
   - Deelnemeraanzichten

## 🔧 Technologie Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Message Queue:** RabbitMQ (voor async communicatie)
- **API Client:** Axios
- **Authentication:** JWT (jsonwebtoken)
- **File Storage:** Azure Blob Storage / Local File System
- **Image Analysis:** Imagga Visual Similarity API
- **Mail:** Nodemailer / SendGrid
- **Containerization:** Docker & Docker Compose

## 🚀 Quick Start

### Vereisten
- Docker & Docker Compose
- Node.js 18+ (voor lokale development)
- npm of yarn

### Setup

1. **Clone repository**
```bash
cd photo-prestige
```

2. **Environment configuratie**
```bash
cp .env.example .env
# Bewerk .env met je credentials
```

3. **Start alle services met Docker Compose**
```bash
docker-compose up -d
```

Services worden beschikbaar op:
- Auth Service: http://localhost:3001
- Register Service: http://localhost:3002
- Target Service: http://localhost:3003
- Mail Service: http://localhost:3004
- Clock Service: http://localhost:3005
- Score Service: http://localhost:3006
- Read Service: http://localhost:3007
- PostgreSQL: localhost:5432
- RabbitMQ: http://localhost:15672 (guest/guest)

### Lokale Development (geen Docker)

```bash
# Install dependencies per service
cd services/auth-service && npm install
cd ../register-service && npm install
# ... repeat voor andere services

# Start services
npm start  # in each service directory
```

## 📡 API Endpoints

### Authentication
- `POST /auth/login` - Login
- `POST /auth/register` - Registratie
- `POST /auth/verify` - Token verificatie

### Registration
- `POST /register/participant` - Deelnemer registratie
- `POST /register/target-owner` - Target eigenaar registratie
- `GET /register/users/:id` - User info

### Targets
- `POST /targets/upload` - Target foto uploaden
- `GET /targets` - Alle targets ophalen
- `GET /targets/:id` - Target detail
- `DELETE /targets/:id` - Target verwijderen

### Scores
- `POST /scores/calculate` - Score berekenen via Imagga
- `GET /scores/target/:targetId` - Alle scores voor target
- `GET /scores/user/:userId` - Gebruiker scores

### Read Service
- `GET /competitions/active` - Actieve wedstrijden
- `GET /competitions/by-location` - Per locatie
- `GET /leaderboard/:targetId` - Leaderboard

## 🖼️ Imagga Visual Similarity Integration

De Score Service integreert met Imagga API:

```javascript
// Imagga endpoints gebruikt
POST /similar-images/categories/general_v3/{index_id}    // Query similarity
PUT  /similar-images/categories/general_v3/{index_id}    // Train index
POST /categories/general_v3                               // Feed image
GET  /tickets/{ticket_id}                                 // Check training status
```

**Features:**
- Visual similarity search between target en participant photos
- Percentage matching voor scores
- Support voor afstandsfiltering (DISTANCE_THRESHOLD)

**Vereisten:**
- Imagga account (https://imagga.com/auth/signup/hacker)
- API Key en Secret in .env

## 📊 Database Schema

Zie [config/schema.sql](config/schema.sql) voor volledige schema.

**Hoofdtabellen:**
- `users` - Gebruikers (Target Owner / Participant)
- `targets` - Targetfoto's met metadata
- `competitions` - Wedstrijden
- `submissions` - Ingezonden foto's
- `scores` - Berekende scores
- `audit_logs` - Logging voor compliance

## 🔐 Beveiliging

- JWT tokens met expiration
- Role-based access control (RBAC)
- Input validation op alle endpoints
- SQL injection preventie (parameterized queries)
- CORS configuratie
- Rate limiting

## 📧 Event-Driven Architecture

Communicatie tussen services via:

1. **Synchronous:** REST API calls
2. **Asynchronous:** RabbitMQ message queue

**Events:**
- `user.registered` - User registratie
- `target.uploaded` - Target upload
- `competition.started` - Wedstrijd gestart
- `competition.closed` - Deadline bereikt
- `scores.calculated` - Scores klaar
- `winner.determined` - Winnaar bepaald

## 📝 Functionaliteiten

### Als Deelnemer
- ✅ Overzicht targets per locatie/coördinaten
- ✅ Gelijkende foto uploaden (niet dezelfde)
- ✅ Score inzien op bepaalde target
- ✅ Eigen upload verwijderen

### Als Target Owner
- ✅ Scores inzien van alle deelnemers
- ✅ Deelnemer scores via email ontvangen
- ✅ Target met locatiebeschrijving uploaden
- ✅ Deadline instellen
- ✅ Reminders naar deelnemers sturen
- ✅ Automatische winnaar bepaling

## 🧪 Testing

```bash
# Unit tests
npm test

# Integration tests met Postman/Insomnia
# Zie /postman directory

# E2E tests
npm run test:e2e
```

## 📋 Scoring Formula

Winnaar bepaling na deadline:
```
Final Score = (Time Factor) × (Similarity %)
Winner: Snelste & Hoogste Match %
```

Voorbeeld: User die 900% match in 10 minuten ⟶ Potentiële winnaar

## 🛠️ Development

### Structuur
```
photo-prestige/
├── services/
│   ├── auth-service/
│   ├── register-service/
│   ├── target-service/
│   ├── mail-service/
│   ├── clock-service/
│   ├── score-service/
│   └── read-service/
├── shared/
│   ├── middleware/
│   ├── utils/
│   └── constants.js
├── config/
│   ├── database.sql
│   ├── schema.sql
│   └── docker-compose.yml
└── docs/
    └── API.md
```

### Debugging
```bash
# Debug modus
DEBUG=* npm start

# View service logs
docker-compose logs -f <service-name>
```

## 📚 Documentatie

- [API Documentation](./docs/API.md)
- [Database Schema](./config/schema.sql)
- [Architecture Decision Records](./docs/ADR.md)
- [Imagga Integration Guide](./docs/IMAGGA.md)

## 🔗 Externe Services

- **Imagga:** https://imagga.com - Visual similarity API
- **SendGrid/Nodemailer:** Email delivery
- **Azure Blob Storage (optional):** Image storage

## 👥 Team Requirements

- **Backend Developers:** Service implementation
- **DevOps:** Docker, deployment, monitoring
- **QA:** API testing, performance testing
- **Product Owner:** Requirements refinement

## 📋 Checkliste

- [ ] Database schema geimplementeerd
- [ ] Auth service werkend
- [ ] Register service werkend
- [ ] Target upload werkend
- [ ] Imagga integratie getest
- [ ] Score berekening werkend
- [ ] Mail service werkend
- [ ] Clock service werkend
- [ ] Read service queries geoptimaliseerd
- [ ] E2E flow getest
- [ ] Load testing voltooid
- [ ] Deployment klaar

## ⚖️ Licentie

Eindopdracht Cloud Services

---

**Opmerking:** Dit project is ontworpen voor educatieve doeleinden. Zorg ervoor dat je bij het assessment je ontwerp kunt onderbouwen!
