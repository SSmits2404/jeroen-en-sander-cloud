# Architecture & Design Document

## System Overview

Photo Prestige is a distributed microservices application designed for scalability and separation of concerns. The system uses event-driven communication and a CQRS-inspired pattern for read/write optimization.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  (Mobile/Web via Postman/Insomnia for testing)                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │ HTTP/REST
┌──────────────────▼──────────────────────────────────────────────┐
│                    API GATEWAY PATTERN                           │
│        (Can be implemented with Kong, Express, Nginx)            │
├──────────────────┬──────────────────────────────────────────────┤
│                  │                                                │
│    Routing      │ Rate Limiting    │ Authentication              │
│    Load Bal.    │ Caching          │ CORS                        │
└──────────────────┼──────────────────────────────────────────────┘
                   │
        ┌──────────┼──────────┬──────────┬──────────┐
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │  Auth  │ │Register│ │ Target │ │ Clock  │ │ Score  │
   │Service │ │Service │ │Service │ │Service │ │Service │
   └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
       │          │          │          │          │
       │          │          │          │          │
       │    ┌─────┴──────────┴──────────┴──────────┴─────┐
       │    │                                            │
       │    ▼                                            │
       │  ┌─────────────────────────────────────┐        │
       │  │      RabbitMQ Message Queue         │        │
       │  │  (Event-Driven Communication)       │        │
       │  └─────────────────────────────────────┘        │
       │    │                                            │
       │    └─────────────────────────────────────┐      │
       │                                          │      │
       ▼                                          ▼      ▼
   ┌───────────────────────────────────────┐  ┌────────┐ ┌────────┐
   │    PostgreSQL Database (Central)      │  │  Mail  │ │  Read  │
   │                                       │  │Service │ │Service │
   │  ┌─────────────────────────────────┐  │  └────────┘ └────────┘
   │  │ - users                          │  │
   │  │ - competitions                   │  │ External Services
   │  │ - submissions                    │  │ ├─ Imagga API (scoring)
   │  │ - scores                         │  │ ├─ SMTP (email)
   │  │ - imagga_index_mappings          │  │ ├─ Cloud Storage (optional)
   │  │ - audit_logs                     │  │
   │  │ - notifications                  │  │
   │  └─────────────────────────────────┘  │
   └───────────────────────────────────────┘
```

## Service Responsibilities

### Auth Service (Port 3001)
**Responsibility:** User authentication and authorization

**Key Features:**
- User registration
- Login with JWT token generation
- Token verification
- Token refresh

**Database Access:** Direct write to `users` table

**External Calls:** None (synchronous only)

**Events Published:**
- `user.registered`

**Events Subscribed:** None

---

### Register Service (Port 3002)
**Responsibility:** User profile and role management

**Key Features:**
- User profile viewing
- Role assignment verification
- Profile updates

**Database Access:** Read/write to `users`, `competition_participants`

**External Calls:** Auth Service for token verification

**Events Published:**
- `user.registered`
- `user.updated`

**Events Subscribed:** None

---

### Target Service (Port 3003)
**Responsibility:** Competition/target management and file uploads

**Key Features:**
- Target photo upload
- Competition creation
- Metadata storage
- File management

**Database Access:** Read/write to `competitions`, `imagga_index_mappings`

**External Calls:** Auth Service, Score Service (to train index)

**Events Published:**
- `target.uploaded`
- `competition.started`

**Events Subscribed:**
- `submission.received` → triggers scoring

**File Handling:**
- Receives multipart/form-data
- Stores in `/uploads` volume
- Can integrate with cloud storage (Azure Blob, S3)

---

### Score Service (Port 3006)
**Responsibility:** Image analysis and scoring via Imagga API

**Key Features:**
- Imagga index training
- Photo similarity comparison
- Score calculation
- Winner determination formula

**Database Access:** Read/write to `scores`, `imagga_index_mappings`, `submissions`

**External Calls:** 
- Imagga API for visual similarity
- Auth Service for verification

**Events Published:**
- `score.calculated`
- `score.training.complete`

**Events Subscribed:**
- `submission.received` → auto-score

**Imagga Integration:**
```
1. Feed target image to index
2. Train index (async with ticket polling)
3. Query with participant images
4. Process distance metrics → similarity %
5. Calculate final score with time factor
```

---

### Clock Service (Port 3005)
**Responsibility:** Competition timing and deadline management

**Key Features:**
- Deadline tracking (background service)
- Scheduled notifications
- Competition state transitions
- Auto-closing expired competitions

**Database Access:** Read/write to `competitions`

**External Calls:**
- Register Service (notify on deadline)
- Mail Service (send reminders)

**Events Published:**
- `competition.closed`
- `reminder.needed`

**Events Subscribed:** None

**Implementation:** Background worker (not HTTP service)

---

### Mail Service (Port 3004)
**Responsibility:** Email notifications

**Key Features:**
- Registration confirmation emails
- Score notification emails
- Winner announcements
- Deadline reminders
- Email logging

**Database Access:** Read/write to `email_logs`, read `users`, `competitions`, `scores`

**External Calls:**
- SMTP server (Nodemailer/SendGrid)

**Events Published:**
- `email.sent`

**Events Subscribed:**
- `user.registered` → send verification
- `score.calculated` → send score update
- `winner.determined` → send announcement
- `reminder.needed` → send reminder

---

### Read Service (Port 3007)
**Responsibility:** Query and reporting (CQRS read model)

**Key Features:**
- Competition queries (active, by location)
- Leaderboard views
- User statistics
- Search and filtering

**Database Access:** Read-only from all tables

**External Calls:**
- Auth Service (token verification)

**Events Published:** None

**Events Subscribed:** None (optional: for view updates)

**Optimization:** 
- Denormalized views
- Caching layer (optional)
- Full-text search support

---

## Data Flow Examples

### Example 1: Target Owner Uploads Photo

```
1. Target Owner → Auth Service: Login
   ├─ Returns JWT token
   
2. Target Owner → Target Service: POST /targets/upload (multipart + token)
   ├─ Service validates token (calls Auth Service)
   ├─ Stores image in /uploads
   ├─ Creates competition record in DB
   ├─ Creates imagga_index_mapping entry
   └─ Publishes: target.uploaded
   
3. Score Service receives: target.uploaded event
   ├─ Calls Imagga API to train index
   ├─ Polls training status
   ├─ Updates is_trained = true when complete
   └─ Publishes: score.training.complete
   
4. Clock Service monitors: competition end_time
   ├─ When end_time approaches, publishes: reminder.needed
   
5. Mail Service receives: reminder.needed
   ├─ Sends reminder emails to registered participants
```

### Example 2: Participant Submits Photo

```
1. Participant → Auth Service: Login
   ├─ Returns JWT token
   
2. Participant → Target Service: POST /submissions/upload (multipart + token)
   ├─ Validates token
   ├─ Stores submission image
   ├─ Creates submission record
   ├─ Records submission time
   └─ Publishes: submission.received
   
3. Score Service receives: submission.received
   ├─ Queries Imagga index with submission image
   ├─ Calculates similarity_percentage from distance metric
   ├─ Calculates final_score = (1 - time_ratio*0.5) * similarity_%
   ├─ Stores score record
   ├─ Updates submission status = 'scored'
   └─ Publishes: score.calculated
   
4. Mail Service receives: score.calculated
   ├─ Sends score update to participant
   ├─ Sends score to target owner (if enabled)
   
5. Participant → Read Service: GET /leaderboard/:competitionId
   ├─ Views current leaderboard
   ├─ Sees their ranking
```

### Example 3: Competition Closes & Winner Determined

```
1. Clock Service detects: end_time reached
   ├─ Updates competition status = 'closed'
   └─ Publishes: competition.closed
   
2. Score Service receives: competition.closed
   ├─ Gets all scores for competition
   ├─ Determines winner (max final_score)
   ├─ Marks is_winner = true, winner_rank assigned
   └─ Publishes: winner.determined
   
3. Mail Service receives: winner.determined
   ├─ Sends winner announcement email
   ├─ Sends congratulations to target owner
   ├─ Sends feedback to all participants
   
4. Target Owner → Read Service: GET /leaderboard/:competitionId
   ├─ Views final results
   ├─ Confirms winner
```

## Technology Decisions

### Why Microservices?
- **Scalability:** Each service can scale independently
- **Resilience:** Failure in one service doesn't bring down entire system
- **Development:** Teams can work on services independently
- **Technology Flexibility:** Each service can use different tech stack

### Why PostgreSQL (not NoSQL)?
- Complex queries (leaderboards, filtering)
- ACID transactions needed (score calculations)
- Relational data (competitions → participants → submissions → scores)
- Full-text search support

### Why RabbitMQ (not REST)?
- Asynchronous decoupling between services
- Guaranteed message delivery
- Built-in retry mechanism
- Easy to add consumers (e.g., analytics)

### Why Imagga (not Google Vision)?
- **No credit card required** (free tier)
- Visual similarity specifically (not just tagging)
- Distance metrics for percentage calculation
- Index-based searching (faster for multiple queries per competition)

### JWT vs Sessions?
- JWT: Stateless, microservices-friendly
- Each service can verify token without database lookup
- Token includes role information
- Expiration built-in (24 hours)

## Deployment Architecture

### Development
- Docker Compose (all services locally)
- Single PostgreSQL instance
- Single RabbitMQ instance
- MailHog for email testing

### Production
- Kubernetes (Docker images)
- Managed PostgreSQL (AWS RDS / Azure Database)
- Managed RabbitMQ (CloudAMQP / AWS MQ)
- SendGrid for email
- Azure Blob Storage for file storage
- CDN for image delivery
- Load balancer for API Gateway
- Monitoring & logging (ELK stack)

## Security Considerations

1. **JWT Secret:** Strong random value, rotated periodically
2. **Password Hashing:** bcryptjs with 10 rounds
3. **SQL Injection:** Parameterized queries (pg library)
4. **Rate Limiting:** 100 requests per 15 minutes
5. **CORS:** Configure for frontend domain
6. **HTTPS:** Required in production
7. **API Key Protection:** Imagga credentials in environment only
8. **Audit Logging:** All mutations logged to audit_logs table

## Performance Optimizations

1. **Database Indexes:**
   - Foreign keys all indexed
   - Status and timestamp columns indexed
   - Composite indexes on common query patterns

2. **Caching:**
   - JWT tokens cached by signature
   - Leaderboard can be cached (5 min TTL)
   - Competition details cached

3. **Read Service:**
   - Denormalized views for fast queries
   - No joins in read operations
   - Pagination (limit/offset)

4. **Imagga Optimization:**
   - Index trained once per competition
   - Distance threshold filters results (no full scan)
   - Async index training doesn't block submission

## Monitoring & Observability

- **Logging:** Winston (structured JSON logs)
- **Health Checks:** `/health` endpoint per service
- **Metrics:** Service uptime, response times, error rates
- **Traces:** Optional Jaeger integration
- **Alerts:** Email notifications on critical errors

## Future Enhancements

1. **API Gateway:** Kong or Ambassador for centralized routing
2. **Caching Layer:** Redis for session/leaderboard caching
3. **Search:** Elasticsearch for advanced competition search
4. **Real-time:** WebSocket support for live leaderboard updates
5. **Mobile App:** Native iOS/Android clients
6. **Analytics:** Dashboard for competition insights
7. **Gamification:** Achievement badges, streaks
8. **Social:** Follow/friend system, photo sharing
