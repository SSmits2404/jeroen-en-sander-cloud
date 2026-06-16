# API Documentation - Photo Prestige

## Service Endpoints

### Authentication Service (Port 3001)

#### Register User
```
POST /auth/register
Content-Type: application/json

{
  "username": "photography_fan",
  "email": "user@example.com",
  "password": "secure_password",
  "firstName": "John",
  "lastName": "Doe",
  "role": "participant"  // or "target_owner"
}

Response: 201 Created
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "username": "photography_fan",
    "email": "user@example.com",
    "role": "participant",
    "created_at": "2024-06-16T10:00:00Z"
  }
}
```

#### Login
```
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}

Response: 200 OK
{
  "token": "eyJhbGc...",  // JWT token
  "user": {
    "id": "uuid",
    "username": "photography_fan",
    "email": "user@example.com",
    "role": "participant"
  }
}
```

#### Verify Token
```
POST /auth/verify
Authorization: Bearer <token>

Response: 200 OK
{
  "valid": true,
  "user": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "participant"
  }
}
```

### Target Service (Port 3003)

#### Upload Target Photo
```
POST /targets/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

Fields:
- photo: <file>
- title: "Dutch Architecture"
- description: "Historic building in Amsterdam"
- location: "Amsterdam, Netherlands"
- latitude: 52.3676
- longitude: 4.9041
- searchRadiusMeters: 100
- deadline: "2024-06-16T18:00:00Z"
- prize: "Annual Museum Pass"

Response: 201 Created
{
  "id": "comp-uuid",
  "targetImageUrl": "https://cdn.example.com/target_abc123.jpg",
  "status": "planned",
  "startTime": "2024-06-16T12:00:00Z",
  "endTime": "2024-06-16T18:00:00Z"
}
```

#### Get Active Competitions
```
GET /targets
Authorization: Bearer <token>
Query params:
- location: "Amsterdam"  (optional)
- lat: 52.3676, lon: 4.9041, radius: 5000  (optional - in meters)
- status: "active"  (optional)

Response: 200 OK
[
  {
    "id": "comp-uuid",
    "title": "Dutch Architecture",
    "location": "Amsterdam",
    "targetImageUrl": "https://cdn.example.com/target_abc123.jpg",
    "owner": {
      "id": "user-uuid",
      "username": "rijksmuseum"
    },
    "status": "active",
    "endTime": "2024-06-16T18:00:00Z",
    "participantCount": 45,
    "submissionCount": 23
  }
]
```

### Score Service (Port 3006)

#### Train Imagga Index
```
POST /scores/train-index
Content-Type: application/json

{
  "competitionId": "comp-uuid",
  "targetImagePath": "/uploads/target_abc123.jpg"
}

Response: 202 Accepted
{
  "message": "Training started",
  "ticketId": "imagga-ticket-123",
  "indexName": "photo_prestige_comp-uuid"
}
```

#### Calculate Score
```
POST /scores/calculate
Content-Type: application/json
Authorization: Bearer <token>

{
  "competitionId": "comp-uuid",
  "submissionId": "sub-uuid",
  "targetImagePath": "/uploads/target_abc123.jpg",
  "submissionImagePath": "/uploads/participant_xyz.jpg"
}

Response: 200 OK
{
  "id": "score-uuid",
  "similarity_percentage": 78.5,
  "distance_score": 0.301,
  "final_score": 65.2,
  "matched_images": [
    {
      "image_id": "target_comp",
      "distance": 0.301,
      "similarity": 78.5
    }
  ],
  "calculated_at": "2024-06-16T10:30:00Z"
}
```

#### Get Competition Leaderboard
```
GET /scores/competition/:competitionId
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "participant_id": "user-uuid",
    "username": "photography_fan_1",
    "similarity_percentage": 85.2,
    "final_score": 72.1,
    "submission_id": "sub-uuid",
    "calculated_at": "2024-06-16T10:30:00Z",
    "is_winner": true,
    "winner_rank": 1
  }
]
```

### Read Service (Port 3007)

#### Get Active Competitions
```
GET /competitions/active
Authorization: Bearer <token>
Query params:
- limit: 20
- offset: 0
- sort: "end_time"  // or "created_at"

Response: 200 OK
{
  "data": [
    {
      "id": "comp-uuid",
      "title": "Dutch Architecture",
      "owner_username": "rijksmuseum",
      "participant_count": 45,
      "submission_count": 23,
      "status": "active",
      "end_time": "2024-06-16T18:00:00Z"
    }
  ],
  "total": 156,
  "limit": 20,
  "offset": 0
}
```

#### Get Competitions by Location
```
GET /competitions/by-location
Authorization: Bearer <token>
Query params:
- location: "Amsterdam"
- lat: 52.3676
- lon: 4.9041
- radiusKm: 10

Response: 200 OK
[
  {
    "id": "comp-uuid",
    "title": "Dutch Architecture",
    "location": "Amsterdam",
    "distance_km": 0.5
  }
]
```

#### Get Leaderboard
```
GET /leaderboard/:competitionId
Authorization: Bearer <token>

Response: 200 OK
{
  "competition": {
    "id": "comp-uuid",
    "title": "Dutch Architecture"
  },
  "leaderboard": [
    {
      "rank": 1,
      "username": "photography_fan_1",
      "similarity": 85.2,
      "final_score": 72.1,
      "is_winner": true
    }
  ]
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing required fields"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid credentials"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 409 Conflict
```json
{
  "error": "User already exists"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Authentication

All endpoints (except /auth/register and /auth/login) require:
```
Authorization: Bearer <jwt_token>
```

Token is valid for 24 hours by default.

## Rate Limiting

- 100 requests per 15 minutes per IP
- Returns 429 Too Many Requests if exceeded

## Pagination

List endpoints support:
- `limit`: Number of results (default 20, max 100)
- `offset`: Number of results to skip (default 0)

## Sorting

Supported sort fields:
- `created_at` (newest first)
- `end_time` (ending soonest first)
- `participant_count` (most participants first)
