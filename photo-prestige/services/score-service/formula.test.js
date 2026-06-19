// De formule: finalScore = (1 - (timeRatio * 0.5)) * similarityPercentage

function calculateFinalScore(startTime, endTime, uploadedAt, similarityPercentage) {
    const competitionDurationMs = new Date(endTime) - new Date(startTime);
    const submissionTimeMs = new Date(uploadedAt) - new Date(startTime);
    const timeRatio = submissionTimeMs / competitionDurationMs;
    
    return (1 - (timeRatio * 0.5)) * similarityPercentage;
}

describe('Score Service - Formule Berekening Tests', () => {
    
    test('Moet de volledige score behouden als de inzending direct bij de start is (timeRatio = 0)', () => {
        const startTime = '2026-06-19T12:00:00.000Z';
        const endTime = '2026-06-19T13:00:00.000Z';
        const uploadedAt = '2026-06-19T12:00:00.000Z'; // Gelijk aan start
        const similarity = 80;

        const score = calculateFinalScore(startTime, endTime, uploadedAt, similarity);
        expect(score).toBe(80); // 0% tijdaftrek, dus 80 blijft 80
    });

    test('Moet de helft van de score aftrekken als de inzending precies op de deadline is (timeRatio = 1)', () => {
        const startTime = '2026-06-19T12:00:00.000Z';
        const endTime = '2026-06-19T13:00:00.000Z';
        const uploadedAt = '2026-06-19T13:00:00.000Z'; // Precies op de deadline
        const similarity = 80;

        const score = calculateFinalScore(startTime, endTime, uploadedAt, similarity);
        // (1 - (1 * 0.5)) * 80 = 0.5 * 80 = 40
        expect(score).toBe(40);
    });
});