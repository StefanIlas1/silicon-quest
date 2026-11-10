"""Check source-grounded seed integrity and the frontend answer boundary."""
import json
from pathlib import Path

root = Path(__file__).parent
seed = json.loads((root / 'data.json').read_text())
public = json.loads((root / 'public-data.json').read_text())
for group in ('books', 'modules', 'phases', 'projects', 'credentials', 'quizQuestions'):
    ids = [item['id'] for item in seed[group]]
    assert len(ids) == len(set(ids)), f'Duplicate IDs in {group}'
books = {item['id'] for item in seed['books']}
phases = {item['id'] for item in seed['phases']}
modules = {item['id'] for item in seed['modules']}
for module in seed['modules']:
    assert module['bookId'] is None or module['bookId'] in books
    assert module['phaseId'] in phases
    assert module['provisional'] is True
for book in seed['books']:
    assert set(book['moduleIds']) <= modules
    assert set(book['phaseIds']) <= phases
for phase in seed['phases']:
    assert set(phase['moduleIds']) <= modules
for question in seed['quizQuestions']:
    assert question['moduleId'] in modules
    assert 0 <= question['correctIndex'] < len(question['choices'])
    assert question['explanation'].strip()
expected_public = dict(seed)
expected_public['quizQuestions'] = [
    {key: value for key, value in question.items() if key not in ('correctIndex', 'explanation')}
    for question in seed['quizQuestions']
]
assert public == expected_public, 'Public seed must match source with answer keys/explanations removed'
assert len(books) == 9 and len(phases) == 7 and len(seed['projects']) == 4
print('Curriculum IDs, references, roadmap counts and public answer boundary passed.')
