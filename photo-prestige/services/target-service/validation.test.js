// Eenvoudige validatiefunctie die we willen testen
function validateAnalyzeRequest(body) {
    const { competitionId, submissionId, submissionImagePath } = body;
    if (!competitionId || !submissionId || !submissionImagePath) {
        return { valid: false, error: 'Missing required fields' };
    }
    return { valid: true };
}

describe('Target Service - Input Validatie Tests', () => {

    test('Moet succesvol valideren als alle verplichte velden aanwezig zijn', () => {
        const validBody = {
            competitionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            submissionId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            submissionImagePath: 'uploads/test.jpg'
        };

        const result = validateAnalyzeRequest(validBody);
        expect(result.valid).toBe(true);
    });

    test('Moet falen met een foutmelding als submissionId ontbreekt', () => {
        const invalidBody = {
            competitionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            // submissionId ontbreekt hier expres!
            submissionImagePath: 'uploads/test.jpg'
        };

        const result = validateAnalyzeRequest(invalidBody);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Missing required fields');
    });
});