"""Check source-grounded seed integrity and the frontend answer boundary."""
import json
from pathlib import Path

root = Path(__file__).parent
seed = json.loads((root / 'data.json').read_text())
public = json.loads((root / 'public-data.json').read_text())
for group in ('books', 'modules', 'phases', 'projects', 'credentials', 'quizQuestions', 'projectMilestones'):
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

project_ids = {item['id'] for item in seed['projects']}
task_ids = []
for milestone in seed['projectMilestones']:
    assert milestone['projectId'] in project_ids
    assert set(milestone['phaseIds']) <= phases
    assert milestone['kind'] in ('work', 'exit_review')
    assert milestone['sourceSection'].startswith('ROADMAP.md')
    assert milestone['doneWhen'].strip() and milestone['evidenceHints']
    assert milestone['tasks']
    assert not {'status', 'evidenceNote', 'reviewNote', 'completedAt'} & set(milestone)
    for task in milestone['tasks']:
        assert task['id'].startswith(milestone['id'] + '-')
        assert task['title'].strip() and task['doneWhen'].strip()
        assert 'done' not in task, 'Curriculum definitions must not seed earned task progress'
        task_ids.append(task['id'])
assert len(task_ids) == len(set(task_ids)), 'Task IDs must be globally unique'
for project_id in project_ids:
    definitions = [item for item in seed['projectMilestones'] if item['projectId'] == project_id]
    assert definitions and any(not item['optional'] for item in definitions)
    exit_reviews = [item for item in definitions if item['kind'] == 'exit_review']
    assert len(exit_reviews) == 1 and exit_reviews[0]['optional'] is False
assert len(seed['projects']) == 4
print(f"Validated {len(seed['projectMilestones'])} roadmap project milestones and {len(task_ids)} unearned child-task definitions.")
