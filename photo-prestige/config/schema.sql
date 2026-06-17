-- Photo Prestige Database Schema
-- Microservices architecture with central PostgreSQL
-- Gecorrigeerd voor Target-Service, Read-Service & Performance compatibiliteit

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For full-text search

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'participant', -- 'participant' or 'target_owner' or 'admin'
    profile_image_url VARCHAR(2048),
    bio TEXT,
    location VARCHAR(255),
    coordinates POINT,  -- (latitude, longitude)
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'suspended'
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    CONSTRAINT valid_role CHECK (role IN ('participant', 'target_owner', 'admin'))
);

-- Indexes for users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_coordinates ON users USING GIST (coordinates);

-- ============================================
-- 2. COMPETITIONS / TARGETS TABLE
-- ============================================
CREATE TABLE targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_owner_id UUID REFERENCES users(id) ON DELETE CASCADE, 
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Toegevoegd voor target-service link
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location_name VARCHAR(255) DEFAULT 'Unknown Location',
    coordinates POINT,  -- (latitude, longitude)
    search_radius_meters INT DEFAULT 100,
    target_image_url VARCHAR(2048),
    target_image_path VARCHAR(2048),
    target_score INT DEFAULT 0, 
    target_photo_count INT DEFAULT 1, 
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    deadline TIMESTAMP, 
    status VARCHAR(50) DEFAULT 'active', 
    prize_description TEXT,
    min_similarity_score INT DEFAULT 70,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backward compatibility link
CREATE OR REPLACE VIEW competitions AS SELECT * FROM targets;

-- Indexes for targets
CREATE INDEX idx_competitions_status ON targets(status);
CREATE INDEX idx_competitions_coordinates ON targets USING GIST (coordinates);

-- ============================================
-- 3. PHOTOS / SUBMISSIONS TABLE (Participant Uploads)
-- ============================================
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID REFERENCES targets(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- Expliciete foreign key link
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(2048),
    image_path VARCHAR(2048),
    file_path VARCHAR(2048), 
    tags TEXT, 
    coordinates POINT,  
    taken_at TIMESTAMP,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'scored', 'rejected'
    submission_time_seconds INT,  
    imagga_image_id VARCHAR(255),  
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backward compatibility link
CREATE OR REPLACE VIEW submissions AS SELECT * FROM photos;

-- Indexes for photos
CREATE INDEX idx_photos_competition_id ON photos(competition_id); -- CRITIEK VOOR JOINS
CREATE INDEX idx_submissions_participant_id ON photos(participant_id);
CREATE INDEX idx_submissions_status ON photos(status);
CREATE INDEX idx_submissions_uploaded_at ON photos(uploaded_at);

-- ============================================
-- 4. SCORES TABLE
-- ============================================
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID REFERENCES targets(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE, -- FIX: Constraint toegevoegd tegen orphans
    participant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    similarity_percentage NUMERIC(5,2),  
    matching_images JSONB,  
    distance_score NUMERIC(5,2),  
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    score INT DEFAULT 0, 
    final_score NUMERIC(10,2),  
    score_formula VARCHAR(255),  
    is_winner BOOLEAN DEFAULT FALSE,
    winner_rank INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_percentage CHECK (similarity_percentage >= 0 AND similarity_percentage <= 100)
);

-- Indexes for scores
CREATE INDEX idx_scores_competition_id ON scores(competition_id); -- SNELLE LEADERBOARDS
CREATE INDEX idx_scores_submission_id ON scores(submission_id);
CREATE INDEX idx_scores_photo_id ON scores(photo_id);
CREATE INDEX idx_scores_participant_id ON scores(participant_id);
CREATE INDEX idx_scores_final_score ON scores(final_score DESC);

-- ============================================
-- 5. VOTES TABLE (Thumbs up/down)
-- ============================================
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    voter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote_type VARCHAR(10) NOT NULL, -- 'thumbs_up', 'thumbs_down'
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_vote UNIQUE (submission_id, voter_id),
    CONSTRAINT valid_vote_type CHECK (vote_type IN ('thumbs_up', 'thumbs_down'))
);

-- ============================================
-- 6. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notification_type VARCHAR(100) NOT NULL,
    competition_id UUID REFERENCES targets(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- ============================================
-- 7. EMAIL_LOGS TABLE
-- ============================================
CREATE TABLE email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_email VARCHAR(255) NOT NULL,
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(255),
    email_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    related_competition_id UUID REFERENCES targets(id) ON DELETE SET NULL,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. AUDIT_LOGS TABLE (Compliance)
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    changes JSONB,
    ip_address INET,
    user_agent VARCHAR(2048),
    status VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 9. IMAGGA_INDEX_MAPPINGS TABLE
-- ============================================
CREATE TABLE imagga_index_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL UNIQUE REFERENCES targets(id) ON DELETE CASCADE,
    imagga_index_name VARCHAR(255) NOT NULL,
    target_imagga_id VARCHAR(255) NOT NULL,
    training_ticket_id VARCHAR(255),
    is_trained BOOLEAN DEFAULT FALSE,
    trained_at TIMESTAMP,
    last_query_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. COMPETITION_PARTICIPANTS TABLE
-- ============================================
CREATE TABLE competition_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'active',
    reminder_sent_at TIMESTAMP,
    score_notified_at TIMESTAMP,
    CONSTRAINT unique_participant UNIQUE (competition_id, participant_id),
    CONSTRAINT valid_status CHECK (status IN ('active', 'withdrawn', 'disqualified'))
);

-- ============================================
-- TRIGGERS & FUNCTIONS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_competitions_updated_at BEFORE UPDATE ON targets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_submissions_updated_at BEFORE UPDATE ON photos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_imagga_mappings_updated_at BEFORE UPDATE ON imagga_index_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS (Gecorrigeerd voor runtime statussen)
-- ============================================

CREATE OR REPLACE VIEW active_competitions AS
SELECT c.*,
       u.username as owner_username,
       COUNT(DISTINCT cp.participant_id) as participant_count,
       COUNT(DISTINCT s.id) as submission_count
FROM targets c
LEFT JOIN users u ON c.target_owner_id = u.id
LEFT JOIN competition_participants cp ON c.id = cp.competition_id AND cp.status = 'active'
-- FIX: Match op statussen die daadwerkelijk in de applicatie voorkomen ('pending' en 'scored')
LEFT JOIN photos s ON c.id = s.competition_id AND s.status IN ('pending', 'scored')
WHERE c.status = 'active' AND (c.end_time > CURRENT_TIMESTAMP OR c.end_time IS NULL)
GROUP BY c.id, u.id;

CREATE OR REPLACE VIEW competition_leaderboard AS
SELECT 
    c.id as competition_id,
    c.title as competition_title,
    s.participant_id,
    u.username,
    u.profile_image_url,
    sc.final_score,
    sc.similarity_percentage,
    sc.submission_id,
    sc.calculated_at,
    sc.is_winner,
    sc.winner_rank,
    ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY sc.final_score DESC, sc.calculated_at ASC) as calculated_rank
FROM targets c
INNER JOIN photos s ON c.id = s.competition_id
INNER JOIN scores sc ON s.id = sc.submission_id
INNER JOIN users u ON s.participant_id = u.id
WHERE c.status IN ('active', 'closed');

CREATE OR REPLACE VIEW user_statistics AS
SELECT 
    u.id,
    u.username,
    COUNT(DISTINCT s.competition_id) as competitions_participated,
    COUNT(DISTINCT s.id) as total_submissions,
    COUNT(DISTINCT CASE WHEN sc.is_winner THEN s.competition_id END) as competitions_won,
    AVG(sc.similarity_percentage)::NUMERIC(5,2) as avg_similarity,
    MAX(sc.similarity_percentage)::NUMERIC(5,2) as best_similarity,
    COUNT(DISTINCT CASE WHEN v.vote_type = 'thumbs_up' THEN v.id END) as thumbs_up_received,
    COUNT(DISTINCT CASE WHEN v.vote_type = 'thumbs_down' THEN v.id END) as thumbs_down_received
FROM users u
LEFT JOIN photos s ON u.id = s.participant_id
LEFT JOIN scores sc ON s.id = sc.submission_id
LEFT JOIN votes v ON s.id = v.submission_id
GROUP BY u.id;