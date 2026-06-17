# Getting Started - Photo Prestige

## Quick Start Guide

### Prerequisites
- Docker & Docker Compose geïnstalleerd
- Node.js 18+ (voor lokale ontwikkeling buiten Docker)
- Imagga account (gratis registratie)
- Postman of Insomnia (voor API testing)

### Step 1: Clone and Setup

```bash
cd photo-prestige
cp .env.example .env
```

### Step 2: Configure Imagga Credentials

1. Go to: https://imagga.com/auth/signup/hacker
2. Create free account
3. Get API Key & Secret from: https://imagga.com/profile/dashboard
4. Add to `.env`:

```env
IMAGGA_API_KEY=your_real_api_key_here
IMAGGA_API_SECRET=your_real_api_secret_here
```

### Step 3: Start Services

```bash
# Bouw en start alle microservices synchroon op met Docker Compose
docker-compose up -d --build

# Bekijk de gecentraliseerde logs live
docker-compose logs -f

# Controleer of alle containers de status 'healthy' of 'running' hebben
docker ps
```

### Step 4: Verify Setup

```bash
# Check each service health
# Controleer de gezondheid van elke microservice via de universele root routes
curl http://localhost:3001/health  # Auth Service
curl http://localhost:3002/health  # Register Service
curl http://localhost:3003/health  # Target Service
curl http://localhost:3004/health  # Mail Service
curl http://localhost:3005/health  # Clock Service
curl http://localhost:3006/health  # Score Service
curl http://localhost:3007/health  # Read Service

# Elke curl hoort netjes terug te geven: {"status": "OK", "service": "..."}

```

## Testing with Postman

### Import Collection
See [postman/Photo-Prestige.postman_collection.json](../postman/Photo-Prestige.postman_collection.json)

### Test Flow

1. **Register User**
   ```
   POST http://localhost:3001/auth/register
   Content-Type: application/json

   {
   "username": "test_user",
   "email": "test@example.com",
   "password": "test123",
   "role": "participant"
   }
   ```

2. **Login**
   ```
   POST http://localhost:3001/auth/login
   Content-Type: application/json

   {
   "email": "test@example.com",
   "password": "test123"
   }
   Response contains JWT token - copy it!
   ```
   

3. **Set Token in Postman**
   - In Postman: `Manage Environments` → Create/Edit environment
   - Add: `token` = `<your_jwt_token>`

4. **Upload Target (as Target Owner)**
   ```
   First register as: role: "target_owner"
   
   POST http://localhost:3003/target/goals
   Authorization: Bearer <token>
   Content-Type: application/json

   {
   "userId": "JOUW_GEBRUIKERS_UUID",
   "title": "Grote Kerk Breda",
   "description": "Fotografeer de kerktoren vanaf de Grote Markt",
   "targetScore": 85,
   "targetPhotoCount": 1,
   "deadline": "2026-12-31T23:59:59.000Z"
   }
   ```

5. **Get Active Competitions**
   ```
   GET http://localhost:3003/target/users/:userId/goals?status=active
   ```

6. **Submit Participation Photo**
   ```
   POST http://localhost:3002/register/photo
      Authorization: Bearer <token>
      -- Verstuur dit als 'form-data' vanwege de Multer bestandsupload --
      Key: photo (Selecteer bestand)
      Key: title (String)
      Key: userId (String/UUID)
      Key: competitionId (String/UUID)
   ```

## Local Development (without Docker)

### Terminal 1: PostgreSQL
```bash
# Using Docker for DB only
docker run -d \
  --name pg-dev \
  -e POSTGRES_PASSWORD=postgres123 \
  -e POSTGRES_DB=photo_prestige \
  -p 5432:5432 \
  postgres:15-alpine

# Sla het gecorrigeerde schema op in de database
psql -U postgres -d photo_prestige -h localhost -f config/schema.sql
```

### Terminal 2: RabbitMQ
```bash
docker run -d \
  --name rabbitmq-dev \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3.12-management-alpine
```

### Terminal 3+: Start Each Service
```bash
cd services/auth-service
npm install
npm run dev
```

Repeat for each service in separate terminals.

## Database Access

### Connect to PostgreSQL
```bash
psql -U postgres -d photo_prestige -h localhost
```

### Useful Queries
```sql
-- Bekijk alle geregistreerde gebruikers en hun rollen
SELECT id, username, email, role, status FROM users;

-- Bekijk alle actieve competities via de gecorrigeerde view
SELECT * FROM active_competitions;

-- Bekijk het realtime klassement voor een specifieke competitie
SELECT username, final_score, similarity_percentage, winner_rank 
FROM competition_leaderboard 
WHERE competition_id = 'COMP_ID_HIER'
ORDER BY final_score DESC;
```

## RabbitMQ Management UI

Access at: http://localhost:15672
- Username: guest
- Password: guest

View messages, queues, and exchanges in real-time.

## Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs <service-name>

# Ensure database is ready
docker-compose exec postgres pg_isready -U postgres

# Restart everything
docker-compose down
docker-compose up -d
```

### "Connection refused" errors
- Wait 30 seconds for services to fully start
- Check health endpoints: `http://localhost:PORT/health`

### JWT token errors
- Token expires after 24 hours
- Login again to get new token
- Check expiration in `.env`: `JWT_EXPIRATION`

### Imagga API errors
- Verify credentials in `.env`
- Check API limits: https://imagga.com/profile/dashboard
- Free tier: 1000 calls/month

## Next Steps

1. Read [API Documentation](./docs/API.md)
2. Review [Imagga Integration Guide](./docs/IMAGGA.md)
3. Check [Database Schema](./config/schema.sql)
4. Explore microservice code in `services/*/index.js`

## Development Tips

### Add Debug Logging
```env
DEBUG=*
```

### Monitor Service Logs
```bash
docker-compose logs -f <service-name>
```

### Restart a Single Service
```bash
docker-compose restart <service-name>
```

### View Network
```bash
docker network inspect photo-prestige-network
```

### Execute Commands in Container
```bash
docker-compose exec <service-name> npm test
```

## Deployment Checklist

- [ ] Update all `.env` with production credentials
- [ ] Set `NODE_ENV=production`
- [ ] Change `JWT_SECRET` to strong random value
- [ ] Configure cloud storage for images (optional)
- [ ] Set up CI/CD pipeline
- [ ] Enable monitoring and logging
- [ ] Configure backups for database
- [ ] Load testing completed
- [ ] Security audit completed

## Support & Resources

- **Documentation:** See `/docs` folder
- **Imagga Docs:** https://docs.imagga.com
- **Express.js:** https://expressjs.com
- **PostgreSQL:** https://www.postgresql.org/docs
- **RabbitMQ:** https://www.rabbitmq.com/documentation.html
