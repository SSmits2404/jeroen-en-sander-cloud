# Implementation Checklist & Development Guide

## Pre-Implementation Requirements

### Infrastructure Setup
- [x] Docker & Docker Compose configured
- [x] PostgreSQL schema created (with migrations)
- [x] RabbitMQ message queue ready
- [x] Imagga API credentials obtained
- [x] Environment variables configured

### Project Structure
- [x] Root README with overview
- [x] Architecture documentation
- [x] Database schema (schema.sql)
- [x] Docker Compose configuration
- [x] Service scaffolding (package.json, Dockerfile per service)
- [x] Shared utilities and constants
- [x] Environment template (.env.example)

---

## Implementation Phases

### Phase 1: Core Services (Week 1)

#### Auth Service (3001)
- [ ] Implement User registration endpoint
  - [ ] Input validation (Joi schemas)
  - [ ] Password hashing (bcryptjs)
  - [ ] Unique constraint handling
  - [ ] Event publishing (user.registered)
  
- [ ] Implement Login endpoint
  - [ ] Email/password verification
  - [ ] JWT token generation
  - [ ] Last login timestamp
  - [ ] Error handling
  
- [ ] Implement Token verification endpoint
  - [ ] JWT signature validation
  - [ ] Expiration check
  - [ ] Role extraction
  
- [ ] Implement Token refresh endpoint
  - [ ] Old token validation
  - [ ] New token generation
  
- [ ] Unit tests (auth logic)
- [ ] Integration tests (with database)

#### Register Service (3002)
- [ ] Implement User profile endpoint
  - [ ] Get user by ID
  - [ ] User statistics query
  - [ ] Profile image URL
  
- [ ] Implement User update endpoint
  - [ ] Profile bio/location/image
  - [ ] Token validation
  
- [ ] RabbitMQ consumer for `user.registered` events
  - [ ] Store verification status
  
- [ ] Tests

#### Target Service (3003)
- [ ] Implement Target upload endpoint
  - [ ] File validation (size, type)
  - [ ] Multipart form-data handling
  - [ ] File storage to /uploads
  - [ ] Create competition record
  - [ ] Create imagga_index_mapping
  - [ ] Publish `target.uploaded` event
  
- [ ] Implement Get competitions endpoint
  - [ ] Filter by status
  - [ ] Filter by location (geospatial)
  - [ ] Pagination
  
- [ ] Implement Submission upload endpoint
  - [ ] Similar file validation
  - [ ] Create submission record
  - [ ] Record submission time
  - [ ] Publish `submission.received` event
  
- [ ] Tests

### Phase 2: Imagga Integration (Week 2)

#### Score Service (3006)
- [ ] Implement Imagga client library
  - [ ] Feed image to index
  - [ ] Train index (with ticket polling)
  - [ ] Query index
  - [ ] Process results
  - [ ] Distance-to-similarity conversion
  
- [ ] Implement Train index endpoint
  - [ ] Create Imagga index
  - [ ] Store ticket ID
  - [ ] Poll completion status
  - [ ] Update is_trained flag
  
- [ ] Implement Calculate score endpoint
  - [ ] Query Imagga with submission
  - [ ] Get similarity percentage
  - [ ] Apply time factor formula
  - [ ] Store score record
  - [ ] Publish `score.calculated` event
  
- [ ] RabbitMQ consumer for `submission.received`
  - [ ] Auto-calculate scores
  
- [ ] Imagga integration tests
  - [ ] Mock Imagga API responses
  - [ ] Test scoring formula
  
- [ ] Production considerations
  - [ ] Error handling for failed queries
  - [ ] Retry logic
  - [ ] Timeout handling

### Phase 3: Email & Async Services (Week 3)

#### Mail Service (3004)
- [ ] Implement email configuration
  - [ ] Nodemailer setup
  - [ ] SendGrid alternative
  - [ ] MailHog for testing
  
- [ ] Implement RabbitMQ consumers
  - [ ] `user.registered` → verification email
  - [ ] `score.calculated` → score notification
  - [ ] `winner.determined` → winner email
  - [ ] `reminder.needed` → deadline reminder
  
- [ ] Implement email templates
  - [ ] HTML email builder
  - [ ] Dynamic content insertion
  
- [ ] Email logging
  - [ ] Store email_logs records
  - [ ] Track delivery status
  
- [ ] Tests

#### Clock Service (3005)
- [ ] Implement deadline checker
  - [ ] Poll competitions table
  - [ ] Check end_time vs NOW()
  - [ ] Background job scheduling
  
- [ ] Implement deadline actions
  - [ ] Update competition status = 'closed'
  - [ ] Publish `competition.closed` event
  - [ ] Publish `reminder.needed` event (1 hour before)
  
- [ ] Tests with time mocking

### Phase 4: Read & Query Optimization (Week 4)

#### Read Service (3007)
- [ ] Implement Active competitions endpoint
  - [ ] Query active_competitions view
  - [ ] Pagination
  - [ ] Sorting options
  
- [ ] Implement Location-based search
  - [ ] Geospatial queries (PostGIS)
  - [ ] Radius filtering
  
- [ ] Implement Leaderboard endpoint
  - [ ] Query leaderboard view
  - [ ] Rank calculation
  - [ ] Winner highlighting
  
- [ ] Caching layer (optional)
  - [ ] Redis integration
  - [ ] Cache invalidation
  
- [ ] Tests with various query patterns

### Phase 5: Integration & Testing (Week 5)

#### End-to-End Testing
- [ ] Full competition workflow
  1. Register participants
  2. Target owner uploads photo
  3. System trains Imagga index
  4. Participants submit photos
  5. System scores all submissions
  6. Deadline reached, winner determined
  7. Emails sent to all parties
  
- [ ] Postman collection execution
- [ ] Load testing (locust/k6)
  - [ ] Concurrent submissions
  - [ ] Concurrent leaderboard queries
  
- [ ] Error scenario testing
  - [ ] Missing image file
  - [ ] Imagga API timeout
  - [ ] Invalid tokens
  - [ ] Database connection loss

#### Documentation Completion
- [ ] API documentation (all endpoints)
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Architecture ADRs

### Phase 6: Deployment & Monitoring (Week 6)

#### Production Preparation
- [ ] Environment configuration for production
  - [ ] Strong JWT_SECRET
  - [ ] Production Imagga credentials
  - [ ] SendGrid setup
  - [ ] Azure Blob Storage (if needed)
  
- [ ] Database migrations
  - [ ] Backup strategy
  - [ ] Scaling considerations
  
- [ ] Docker image optimization
  - [ ] Multi-stage builds
  - [ ] Minimal base images
  - [ ] Security scanning
  
- [ ] Kubernetes manifests (if needed)
  - [ ] Deployments
  - [ ] Services
  - [ ] ConfigMaps
  - [ ] Secrets

#### Monitoring
- [ ] Structured logging (ELK)
- [ ] Health check endpoints
- [ ] Metrics collection
- [ ] Alert thresholds
- [ ] Audit logging review

---

## Testing Strategy

### Unit Tests
```javascript
// Example test structure
describe('Score Service', () => {
  describe('calculateScore', () => {
    it('should calculate correct final score with time factor', () => {
      // Test scoring formula
    });
    
    it('should handle Imagga API errors gracefully', () => {
      // Test error handling
    });
  });
});
```

**Coverage Target:** 80%+ for critical paths

### Integration Tests
- Database operations
- RabbitMQ messaging
- Imagga API calls (mocked)
- Email sending (MailHog)

### E2E Tests
- Full workflow in Postman
- Timing verifications
- Event chain validations

### Load Testing
```bash
# Example with k6
k6 run load-test.js --vus 100 --duration 10m
```

---

## Database Development

### Schema Evolution
```bash
# Add migration (if using migrations)
npm run migration:create add_audit_logs

# Run migrations
npm run migration:run

# Rollback (if needed)
npm run migration:rollback
```

### Common Queries for Testing
```sql
-- Check all users registered
SELECT COUNT(*) FROM users;

-- Check active competitions
SELECT * FROM active_competitions;

-- Check score calculations
SELECT s.*, u.username FROM scores s JOIN users u ON s.participant_id = u.id ORDER BY s.final_score DESC;

-- Check for failures
SELECT * FROM email_logs WHERE status = 'failed';

-- Audit trail
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
```

---

## Debugging Tips

### View Service Logs
```bash
# Single service
docker-compose logs -f auth-service

# All services
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100
```

### Execute Commands in Container
```bash
# Run psql in database
docker-compose exec postgres psql -U postgres -d photo_prestige

# Check RabbitMQ queues
docker-compose exec rabbitmq rabbitmqctl list_queues

# Inspect service network
docker network inspect photo-prestige-network
```

### Test Imagga API Locally
```bash
# Feed image
curl -X POST https://api.imagga.com/v2/categories/general_v3 \
  -u YOUR_KEY:YOUR_SECRET \
  -F "image=@test.jpg" \
  -F "save_id=test_1" \
  -F "save_index=dev_test"

# Check status
curl -X GET https://api.imagga.com/v2/tickets/TICKET_ID \
  -u YOUR_KEY:YOUR_SECRET
```

---

## Code Standards

### Project Layout
```
service-name/
├── index.js          # Main entry point
├── package.json      # Dependencies
├── Dockerfile        # Docker config
├── middleware/
│   ├── auth.js       # Token verification
│   └── error.js      # Error handling
├── routes/
│   ├── auth.js
│   ├── targets.js
│   └── scores.js
├── services/
│   ├── imagga.js     # Business logic
│   └── database.js
├── tests/
│   ├── unit/
│   └── integration/
└── README.md
```

### Code Style
- ESLint configuration provided
- 2-space indentation
- Consistent error handling
- Structured logging

### Naming Conventions
- Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.js`
- Database: `snake_case`

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Connection refused" | Services not started | Wait 30s, check `docker-compose ps` |
| JWT token invalid | Token expired or wrong secret | Login again, check JWT_SECRET in .env |
| Imagga 401 error | Invalid credentials | Verify API Key/Secret in .env |
| Database migrations failed | Schema already exists | Run `docker-compose down -v` (wipes DB) |
| RabbitMQ queue not working | No consumer bound | Verify queue names and binding keys |
| Emails not sending | MailHog not running | Check `docker-compose logs mailhog` |
| Out of memory | Too many simultaneous uploads | Limit concurrent requests, increase container memory |

---

## Performance Benchmarks

Target metrics:
- Auth login: < 200ms
- Score calculation: < 500ms (depends on Imagga)
- Leaderboard query: < 100ms
- List competitions: < 100ms
- System handles: 100 concurrent users

---

## Deployment Checklist

Before going to production:
- [ ] All services passing tests
- [ ] Environment variables configured
- [ ] Database backups automated
- [ ] SSL/HTTPS enabled
- [ ] Rate limiting configured
- [ ] Monitoring active
- [ ] Logging centralized
- [ ] Disaster recovery plan
- [ ] Performance baseline established
- [ ] Security audit completed

---

## Team Assignments

| Service | Owner | Status |
|---------|-------|--------|
| Auth Service | Team Member A | In Progress |
| Register Service | Team Member B | Planned |
| Target Service | Team Member A | Planned |
| Score Service | Team Member C (Imagga expert) | Planned |
| Mail Service | Team Member D | Planned |
| Clock Service | Team Member B | Planned |
| Read Service | Team Member C | Planned |

---

## Timeline

**Week 1:** Core services scaffolding + Auth service implementation
**Week 2:** Imagga integration, Score service
**Week 3:** Email & Clock services
**Week 4:** Read service, caching optimization
**Week 5:** Full E2E testing, load testing, bug fixes
**Week 6:** Deployment, monitoring, production release

---

## Review Criteria

Each phase requires:
- [ ] Code review (2+ approvals)
- [ ] Tests passing (100% critical path coverage)
- [ ] Documentation updated
- [ ] No breaking changes to existing APIs
- [ ] Performance benchmarks met

---

## Success Metrics

- ✅ All endpoints responding correctly
- ✅ 95%+ test coverage for business logic
- ✅ < 1% error rate in production
- ✅ Successful scoring on 100+ competitions
- ✅ Winner determined automatically post-deadline
- ✅ Email notifications delivered successfully
- ✅ System handles 1000+ concurrent participants

---

*Last Updated: 2024-06-16*
