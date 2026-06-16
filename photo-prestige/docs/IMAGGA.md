# Imagga Visual Similarity Integration Guide

## Overview

Photo Prestige uses **Imagga's Visual Similarity Search** API to automatically score photo matches. When a participant uploads a photo, the system compares it with the target image using Imagga's deep learning algorithms.

## Key Concepts

### Visual Similarity Index
- Each competition gets its own Imagga index
- The target image is fed to the index and it's trained
- Participant submissions are queried against this index
- Results include similarity scores (distance metrics)

### Distance Score
- **Lower distance = More similar**
- Distance 0.0 = Identical
- Distance 1.4+ = Very different
- We convert this to a similarity percentage: `similarity % = max(0, 100 * (1 - distance/1.4))`

## Setup

### 1. Create Imagga Account
```
1. Go to: https://imagga.com/auth/signup/hacker
2. Sign up for FREE tier
3. Navigate to Dashboard: https://imagga.com/profile/dashboard
4. Copy your API Key and API Secret
```

### 2. Configure Environment
Add to `.env`:
```env
IMAGGA_API_KEY=your_api_key_here
IMAGGA_API_SECRET=your_api_secret_here
IMAGGA_API_URL=https://api.imagga.com/v2
IMAGGA_SIMILARITY_DISTANCE_THRESHOLD=1.4
IMAGGA_INDEX_NAME=photo_prestige_index
```

### 3. Docker Compose
The Score Service will automatically use these credentials. No manual setup needed!

## API Workflow

### Step 1: Feed Target Image
```javascript
POST /categories/general_v3
Parameters:
  - image: target_photo.jpg
  - save_id: "target_competition_123"
  - save_index: "photo_prestige_competition_123"
```

### Step 2: Train Index
```javascript
PUT /similar-images/categories/general_v3/photo_prestige_competition_123
Response: { ticket_id: "abc123" }
```

### Step 3: Poll Training Status
```javascript
GET /tickets/abc123
Response: { is_final: true/false }
```

### Step 4: Query Similarity
```javascript
POST /similar-images/categories/general_v3/photo_prestige_competition_123?distance=1.4
Body: 
  - image: participant_photo.jpg

Response:
{
  "result": {
    "images": [
      {
        "id": "target_competition_123",
        "distance": 0.45      // Lower = more similar
      },
      {
        "id": "other_participant_image",
        "distance": 1.2
      }
    ]
  }
}
```

## Implementation Details

### Score Service Endpoints

#### 1. Train Competition Index
```
POST /scores/train-index
Content-Type: application/json

{
  "competitionId": "comp-uuid",
  "targetImagePath": "/uploads/target_photo.jpg"
}

Response: { 
  "message": "Training started",
  "ticketId": "ticket-id",
  "indexName": "photo_prestige_comp-uuid"
}
```

#### 2. Calculate Score
```
POST /scores/calculate
Content-Type: application/json

{
  "competitionId": "comp-uuid",
  "submissionId": "sub-uuid",
  "targetImagePath": "/uploads/target_photo.jpg",
  "submissionImagePath": "/uploads/participant_photo.jpg"
}

Response: {
  "id": "score-uuid",
  "competition_id": "comp-uuid",
  "similarity_percentage": 78.5,
  "distance_score": 0.301,
  "final_score": 65.2,    // Score with time factor
  "matching_images": [...],
  "calculated_at": "2024-06-16T10:30:00Z"
}
```

#### 3. Get Competition Scores
```
GET /scores/competition/:competitionId

Response: [
  {
    "id": "score-uuid",
    "similarity_percentage": 78.5,
    "final_score": 65.2,
    "participant_id": "user-uuid",
    "username": "photography_fan_1",
    "calculated_at": "2024-06-16T10:30:00Z"
  },
  ...
]
```

## Scoring Formula

**Final Score** combines two factors:

```
Final Score = (1 - (time_ratio * 0.5)) × similarity_percentage

Where:
  - time_ratio = (submission_time - competition_start) / (competition_end - competition_start)
  - time_weight = 0.5 (50% of score influenced by speed)
  - similarity_percentage = 0-100 (from Imagga distance metric)
```

**Example:**
- Participant submits at 10 minutes (competition is 24 hours = 1440 minutes)
- time_ratio = 10/1440 = 0.0069
- Imagga returns distance 0.3 → similarity = 78.6%
- Final Score = (1 - 0.0069 × 0.5) × 78.6 = 78.3 points

**Winner:** Highest final_score (fastest + highest match %)

## Free Tier Limits

- **First 1000 API calls/month:** FREE
- After that: ~$0.003 per call
- Generous enough for development and testing

## Testing with cURL

### 1. Train Index
```bash
# Feed target image
curl -X POST "https://api.imagga.com/v2/categories/general_v3" \
  -u "your_api_key:your_api_secret" \
  -F "image=@target_photo.jpg" \
  -F "save_id=target_1" \
  -F "save_index=test_index_1"

# Train index
curl -X PUT "https://api.imagga.com/v2/similar-images/categories/general_v3/test_index_1" \
  -u "your_api_key:your_api_secret"

# Check status
curl -X GET "https://api.imagga.com/v2/tickets/TICKET_ID" \
  -u "your_api_key:your_api_secret"
```

### 2. Query Index
```bash
curl -X POST "https://api.imagga.com/v2/similar-images/categories/general_v3/test_index_1?distance=1.4" \
  -u "your_api_key:your_api_secret" \
  -F "image=@participant_photo.jpg"
```

## Troubleshooting

### Issue: API Key Errors
**Solution:** Verify credentials in dashboard at https://imagga.com/profile/dashboard

### Issue: Training Timeout
**Solution:** Increase IMAGGA_TRAINING_TIMEOUT_MS in .env (default 10 minutes)

### Issue: Low Similarity Scores
**Solution:** This is normal! Photos need to be taken from exact same location/angle
- Distance threshold of 1.4 = low similarity tolerance
- Adjust if needed based on competition feedback

### Issue: Rate Limiting
**Solution:** Free tier allows 1000 calls/month. Monitor usage in Imagga dashboard.

## Architecture Integration

```
Competition Created
    ↓
Target Service receives upload
    ↓
Score Service.train-index()
    ↓
Feed target to Imagga → Create Index
    ↓
Imagga.trainIndex()
    ↓
[Async] Wait for training complete
    ↓
Store mapping in imagga_index_mappings table
    ↓
Participant uploads submission
    ↓
Score Service.calculate()
    ↓
Query Imagga index with submission
    ↓
Process results → Calculate final score
    ↓
Store in scores table
    ↓
Publish 'score.calculated' event
    ↓
Mail Service gets event → Send notification
    ↓
Winner announced after deadline
```

## References

- Imagga Docs: https://docs.imagga.com
- API Blog Post: https://imagga.com/blog/how-to-use-the-imagga-visual-similarity-search/
- Free Signup: https://imagga.com/auth/signup/hacker
