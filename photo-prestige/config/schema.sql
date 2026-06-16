-- Photo Prestige Database Schema
-- Microservices architecture with central PostgreSQL

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
-- 2. COMPETITIONS TABLE
-- ============================================
CREATE TABLE competitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location_name VARCHAR(255) NOT NULL,
    coordinates POINT NOT NULL,  -- (latitude, longitude)
    search_radius_meters INT DEFAULT 100,
    target_image_url VARCHAR(2048) NOT NULL,
    target_image_path VARCHAR(2048),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'planned', -- 'planned', 'active', 'closed', 'cancelled'
    prize_description TEXT,
    min_similarity_score INT DEFAULT 70,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('planned', 'active', 'closed', 'cancelled')),
    CONSTRAINT valid_times CHECK (end_time > start_time)
);

-- Indexes for competitions
CREATE INDEX idx_competitions_owner_id ON competitions(target_owner_id);
CREATE INDEX idx_competitions_status ON competitions(status);
CREATE INDEX idx_competitions_coordinates ON competitions USING GIST (coordinates);
CREATE INDEX idx_competitions_end_time ON competitions(end_time);
CREATE INDEX idx_competitions_start_time ON competitions(start_time);

-- ============================================
-- 3. SUBMISSIONS TABLE (Participant Uploads)
-- ============================================
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url VARCHAR(2048) NOT NULL,
    image_path VARCHAR(2048),
    coordinates POINT,  -- Camera position where photo was taken
    taken_at TIMESTAMP,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'submitted', -- 'submitted', 'scored', 'rejected'
    submission_time_seconds INT,  -- Time from competition start to submission
    imagga_image_id VARCHAR(255),  -- Reference to Imagga indexed image
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('submitted', 'scored', 'rejected'))
);

-- Indexes for submissions
CREATE INDEX idx_submissions_competition_id ON submissions(competition_id);
CREATE INDEX idx_submissions_participant_id ON submissions(participant_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_uploaded_at ON submissions(uploaded_at);

-- ============================================
-- 4. SCORES TABLE
-- ============================================
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    similarity_percentage NUMERIC(5,2),  -- 0-100
    matching_images JSONB,  -- Imagga response with matched image IDs
    distance_score NUMERIC(5,2),  -- Imagga distance metric
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    final_score NUMERIC(10,2),  -- Combined score (time + similarity)
    score_formula VARCHAR(255),  -- Formula used for calculation
    is_winner BOOLEAN DEFAULT FALSE,
    winner_rank INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_percentage CHECK (similarity_percentage >= 0 AND similarity_percentage <= 100)
);

-- Indexes for scores
CREATE INDEX idx_scores_competition_id ON scores(competition_id);
CREATE INDEX idx_scores_submission_id ON scores(submission_id);
CREATE INDEX idx_scores_participant_id ON scores(participant_id);
CREATE INDEX idx_scores_final_score ON scores(final_score DESC);
CREATE INDEX idx_scores_is_winner ON scores(is_winner);

-- ============================================
-- 5. VOTES TABLE (Thumbs up/down)
-- ============================================
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    voter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote_type VARCHAR(10) NOT NULL, -- 'thumbs_up', 'thumbs_down'
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_vote UNIQUE (submission_id, voter_id),
    CONSTRAINT valid_vote_type CHECK (vote_type IN ('thumbs_up', 'thumbs_down'))
);

-- Indexes for votes
CREATE INDEX idx_votes_submission_id ON votes(submission_id);
CREATE INDEX idx_votes_voter_id ON votes(voter_id);
CREATE INDEX idx_votes_vote_type ON votes(vote_type);

-- ============================================
-- 6. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notification_type VARCHAR(100) NOT NULL, -- 'score_update', 'winner', 'reminder', etc
    competition_id UUID REFERENCES competitions(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSONB,  -- Additional context
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Indexes for notifications
CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================
-- 7. EMAIL_LOGS TABLE
-- ============================================
CREATE TABLE email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_email VARCHAR(255) NOT NULL,
    recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    subject VARCHAR(255),
    email_type VARCHAR(100), -- 'verification', 'score', 'winner', 'reminder', etc
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'bounced'
    error_message TEXT,
    related_competition_id UUID REFERENCES competitions(id) ON DELETE SET NULL,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for email_logs
CREATE INDEX idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX idx_email_logs_status ON email_logs(status);
CREATE INDEX idx_email_logs_created_at ON email_logs(created_at DESC);

-- ============================================
-- 8. AUDIT_LOGS TABLE (Compliance)
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    changes JSONB,  -- What changed
    ip_address INET,
    user_agent VARCHAR(2048),
    status VARCHAR(50), -- 'success', 'failed'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit_logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- ============================================
-- 9. IMAGGA_INDEX_MAPPINGS TABLE
-- ============================================
CREATE TABLE imagga_index_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
    imagga_index_name VARCHAR(255) NOT NULL,
    target_imagga_id VARCHAR(255) NOT NULL,
    training_ticket_id VARCHAR(255),
    is_trained BOOLEAN DEFAULT FALSE,
    trained_at TIMESTAMP,
    last_query_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for imagga_index_mappings
CREATE INDEX idx_imagga_mappings_competition_id ON imagga_index_mappings(competition_id);
CREATE INDEX idx_imagga_mappings_is_trained ON imagga_index_mappings(is_trained);

-- ============================================
-- 10. COMPETITION_PARTICIPANTS TABLE
-- ============================================
CREATE TABLE competition_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'withdrawn', 'disqualified'
    reminder_sent_at TIMESTAMP,
    score_notified_at TIMESTAMP,
    CONSTRAINT unique_participant UNIQUE (competition_id, participant_id),
    CONSTRAINT valid_status CHECK (status IN ('active', 'withdrawn', 'disqualified'))
);

-- Indexes for competition_participants
CREATE INDEX idx_comp_participants_competition_id ON competition_participants(competition_id);
CREATE INDEX idx_comp_participants_participant_id ON competition_participants(participant_id);

-- ============================================
-- TRIGGERS & FUNCTIONS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for competitions
CREATE TRIGGER update_competitions_updated_at
BEFORE UPDATE ON competitions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for submissions
CREATE TRIGGER update_submissions_updated_at
BEFORE UPDATE ON submissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for imagga_index_mappings
CREATE TRIGGER update_imagga_mappings_updated_at
BEFORE UPDATE ON imagga_index_mappings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS
-- ============================================

-- View: Active Competitions
CREATE OR REPLACE VIEW active_competitions AS
SELECT c.*,
       u.username as owner_username,
       COUNT(cp.participant_id) as participant_count,
       COUNT(s.id) as submission_count
FROM competitions c
LEFT JOIN users u ON c.target_owner_id = u.id
LEFT JOIN competition_participants cp ON c.id = cp.competition_id AND cp.status = 'active'
LEFT JOIN submissions s ON c.id = s.competition_id AND s.status = 'submitted'
WHERE c.status = 'active' AND c.end_time > CURRENT_TIMESTAMP
GROUP BY c.id, u.id;

-- View: Competition Leaderboard
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
FROM competitions c
INNER JOIN submissions s ON c.id = s.competition_id
INNER JOIN scores sc ON s.id = sc.submission_id
INNER JOIN users u ON s.participant_id = u.id
WHERE c.status IN ('active', 'closed');

-- View: User Statistics
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
LEFT JOIN submissions s ON u.id = s.participant_id
LEFT JOIN scores sc ON s.id = sc.submission_id
LEFT JOIN votes v ON s.id = v.submission_id
GROUP BY u.id;

-- ============================================
-- SAMPLE DATA (Optional - for development)
-- ============================================

-- Insert sample user (Target Owner)
INSERT INTO users (username, email, password_hash, first_name, last_name, role, location, bio)
VALUES (
    'rijksmuseum',
    'curator@rijksmuseum.nl',
    '$2b$10$example_hash_here',
    'Rijks',
    'Museum',
    'target_owner',
    'Amsterdam, Netherlands',
    'Official Rijksmuseum Account'
) ON CONFLICT (email) DO NOTHING;

-- Insert sample users (Participants)
INSERT INTO users (username, email, password_hash, first_name, last_name, role)
VALUES 
    ('photography_fan_1', 'user1@example.com', '$2b$10$example_hash_here', 'John', 'Doe', 'participant'),
    ('photography_fan_2', 'user2@example.com', '$2b$10$example_hash_here', 'Jane', 'Smith', 'participant')
ON CONFLICT (email) DO NOTHING;
