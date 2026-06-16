# Photo Prestige - Project Structure

Complete overview van de project directory structuur:

```
photo-prestige/
│
├── README.md                      # Main project overview
├── GETTING_STARTED.md             # Quick start guide
├── IMPLEMENTATION.md              # Development checklist & phases
├── setup.sh                       # Linux/Mac setup script
├── setup.bat                      # Windows setup script
│
├── .env                           # Environment configuration (DO NOT COMMIT)
├── .env.example                   # Environment template
├── .gitignore                     # Git ignore rules
├── docker-compose.yml             # Multi-container orchestration
│
├── config/
│   └── schema.sql                 # PostgreSQL database schema
│       ├── Tables: users, competitions, submissions, scores, votes
│       ├── Views: active_competitions, leaderboard, user_statistics
│       └── Functions: update_updated_at_column
│
├── docs/
│   ├── API.md                     # API endpoint documentation
│   ├── ARCHITECTURE.md            # System design & data flows
│   ├── IMAGGA.md                  # Imagga API integration guide
│   └── ADR.md                     # Architecture decision records (future)
│
├── shared/
│   └── constants.js               # Global constants, error messages, configs
│       ├── Service ports & names
│       ├── User roles & statuses
│       ├── Event names (RabbitMQ)
│       ├── HTTP status codes
│       ├── Image validation rules
│       └── Scoring formulas
│
├── services/
│   │
│   ├── auth-service/              # Authentication & Authorization (Port 3001)
│   │   ├── index.js               # Main server & routes
│   │   ├── package.json           # Dependencies
│   │   └── Dockerfile             # Container config
│   │
│   ├── register-service/          # User Profile Management (Port 3002)
│   │   ├── index.js               # Main server & routes
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── target-service/            # Competition & Target Upload (Port 3003)
│   │   ├── index.js               # Main server & routes
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── mail-service/              # Email Notifications (Port 3004)
│   │   ├── index.js               # RabbitMQ consumer & mail sender
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── clock-service/             # Competition Timing (Port 3005)
│   │   ├── index.js               # Background worker for deadlines
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── score-service/             # Image Analysis & Scoring (Port 3006)
│   │   ├── index.js               # Main server & routes
│   │   ├── imagga-client.js        # Imagga API wrapper
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   └── read-service/              # Query & Reporting (Port 3007)
│       ├── index.js               # Main server & routes (read-only)
│       ├── package.json
│       └── Dockerfile
│
├── postman/
│   └── Photo-Prestige.postman_collection.json   # API testing collection
│
├── uploads/                       # Local file storage (volume mount)
│   └── (target photos & submissions stored here)
│
└── logs/                          # Application logs
    └── (service-name.log files)


SERVICE ARCHITECTURE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────┐
│         Auth Service (3001)              │
│  - Register user                         │
│  - Login & token generation              │
│  - Token verification                    │
└─────────────────────────────────────────┘
                    │
                    ├─► JWT Token
                    │
                    ▼
┌─────────────────────────────────────────┐
│      Register Service (3002)             │
│  - User profiles                         │
│  - Role management                       │
│  - Profile updates                       │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│      Target Service (3003)               │
│  - Upload target photos                  │
│  - Create competitions                   │
│  - Manage submissions                    │
└─────────────────────────────────────────┘
                    │
          ┌─────────┼─────────┐
          │         │         │
          ▼         ▼         ▼
┌──────────────────────────────────┐
│     RabbitMQ Message Queue       │
│  - topic exchanges               │
│  - async communication           │
│  - event-driven flow             │
└──────────────────────────────────┘
    │                  │                │
    ▼                  ▼                ▼
┌─────────────────────────────────────────┐
│      Score Service (3006)                │
│  - Imagga API integration                │
│  - Visual similarity search              │
│  - Score calculation & ranking           │
│  - Winner determination                  │
└─────────────────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────────┐ ┌──────────┐ ┌────────────┐
│ Mail Svc    │ │ Clock    │ │ Read       │
│ (3004)      │ │ Svc      │ │ Service    │
│ - Emails    │ │ (3005)   │ │ (3007)     │
│ - Notif.    │ │ - Timer  │ │ - Query    │
│             │ │ - Dead   │ │ - Reports  │
└─────────────┘ │   lines  │ └────────────┘
                └──────────┘
                    │
                    ▼
         ┌──────────────────────────┐
         │   PostgreSQL Database    │
         │  - users                 │
         │  - competitions          │
         │  - submissions           │
         │  - scores                │
         │  - votes                 │
         │  - notifications         │
         │  - audit_logs            │
         │  - imagga_mappings       │
         └──────────────────────────┘


KEY FILES BY PURPOSE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

API Documentation:
  - docs/API.md                     ← All endpoints
  - postman/collection.json         ← Test endpoints

Architecture:
  - README.md                       ← Project overview
  - docs/ARCHITECTURE.md            ← System design
  - docker-compose.yml              ← Service orchestration

Database:
  - config/schema.sql               ← All tables & views

Imagga Integration:
  - docs/IMAGGA.md                  ← Setup & usage
  - services/score-service/imagga-client.js  ← Implementation

Development:
  - GETTING_STARTED.md              ← Quick start
  - IMPLEMENTATION.md               ← Dev checklist
  - setup.sh / setup.bat            ← Automation
  - shared/constants.js             ← Global config

Environment:
  - .env.example                    ← Template
  - .env                            ← Actual config (DO NOT COMMIT)


QUICK COMMANDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Setup & Start
$ docker-compose up -d                   # Start all services
$ docker-compose down                    # Stop all services
$ docker-compose logs -f                 # View all logs

# Database
$ docker-compose exec postgres psql -U postgres -d photo_prestige
$ \dt                                    # List tables
$ SELECT * FROM active_competitions;     # View active competitions

# Test API
$ curl http://localhost:3001/auth/health # Test auth service
$ curl http://localhost:3006/health      # Test score service

# RabbitMQ Management
# Access: http://localhost:15672 (guest:guest)

# Mail Testing
# Access: http://localhost:8025          # MailHog web UI


DATABASE SCHEMA SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

users (Central)
├── id (UUID)
├── username, email (unique)
├── role: 'participant' | 'target_owner' | 'admin'
├── password_hash
└── Profile fields (bio, location, image_url)

competitions (Target uploads)
├── id (UUID)
├── target_owner_id (FK users)
├── title, description
├── location_name, coordinates (POINT)
├── target_image_url
├── start_time, end_time
├── status: 'planned' | 'active' | 'closed' | 'cancelled'
└── prize_description

submissions (Participant photos)
├── id (UUID)
├── competition_id (FK)
├── participant_id (FK users)
├── image_url
├── coordinates (where taken)
├── uploaded_at
├── status: 'submitted' | 'scored' | 'rejected'
└── imagga_image_id (reference)

scores (Results)
├── id (UUID)
├── competition_id, submission_id (FKs)
├── participant_id (FK)
├── similarity_percentage (0-100)
├── distance_score (Imagga metric)
├── final_score (with time factor)
├── is_winner (boolean)
└── winner_rank (int)

imagga_index_mappings (Index tracking)
├── id (UUID)
├── competition_id (unique FK)
├── imagga_index_name
├── training_ticket_id
├── is_trained (boolean)
└── trained_at (timestamp)

Plus tables: votes, notifications, email_logs, audit_logs, competition_participants


IMAGGA WORKFLOW:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Target uploaded
   ↓
2. Score Service creates Imagga index
   ↓
3. Feed target image to index
   ↓
4. Train index (async with polling)
   ↓
5. Mark as trained (is_trained = true)
   ↓
6. Participant uploads photo
   ↓
7. Query Imagga with participant photo
   ↓
8. Get similarity distance (lower = more similar)
   ↓
9. Convert to percentage (0-100%)
   ↓
10. Apply time factor formula
    Final Score = (1 - (time_ratio * 0.5)) * similarity_%
   ↓
11. Store score, determine ranking
   ↓
12. After deadline, mark winner


EXTERNAL SERVICES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Imagga API (https://imagga.com)
  - Visual similarity search
  - Free tier: 1000 calls/month
  - No credit card required

✓ SMTP (Email)
  - Local: MailHog (development)
  - Production: SendGrid / your server

✓ Cloud Storage (Optional)
  - Azure Blob Storage
  - AWS S3
  - Or use local filesystem


NEXT STEPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Read GETTING_STARTED.md for setup instructions
2. Review docs/API.md for all endpoints
3. Check docs/IMAGGA.md for image analysis setup
4. Start with IMPLEMENTATION.md phase checklist
5. Use postman/collection.json for API testing

Good luck with your Photo Prestige project! 🚀📸
```
