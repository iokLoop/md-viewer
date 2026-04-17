import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, jsonify, request, abort
import markdown as md_lib

app = Flask(__name__)

APP_DIR    = Path(__file__).parent
APP_NAME   = APP_DIR.name
# MDVIEWER_WORKSPACE env var lets the install script point to any directory
_ws_env    = os.environ.get('MDVIEWER_WORKSPACE', '')
WORKSPACE  = Path(_ws_env) if _ws_env else APP_DIR.parent
PORT       = int(os.environ.get('MDVIEWER_PORT', '7700'))
SKIP_DIRS  = {APP_NAME, '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build'}
MD_EXT     = ['tables', 'fenced_code', 'toc', 'attr_list', 'nl2br', 'sane_lists', 'footnotes']


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_projects():
    projects = []
    for d in sorted(WORKSPACE.iterdir()):
        if not d.is_dir():
            continue
        if d.name in SKIP_DIRS or d.name.startswith('.'):
            continue
        md_files = list(d.rglob('*.md'))
        if not md_files:
            continue
        notes_path = d / '.notes.json'
        notes = {}
        if notes_path.exists():
            try:
                notes = json.loads(notes_path.read_text())
            except Exception:
                pass
        total_annotations = sum(
            len(f.get('annotations', []))
            for f in notes.get('files', {}).values()
        )
        total_completed = sum(
            len(f.get('completed_sections', []))
            for f in notes.get('files', {}).values()
        )
        projects.append({
            'name': d.name,
            'md_count': len(md_files),
            'annotations': total_annotations,
            'completed': total_completed,
            'has_notes': notes_path.exists(),
        })
    return projects


def get_md_files(project_name):
    project_dir = WORKSPACE / project_name
    if not project_dir.exists():
        return []
    files = []
    for f in sorted(project_dir.rglob('*.md')):
        rel = f.relative_to(project_dir)
        files.append({
            'path': str(rel),
            'name': f.stem,
            'folder': str(rel.parent) if str(rel.parent) != '.' else '',
            'size_kb': round(f.stat().st_size / 1024, 1),
        })
    return files


def load_notes(project_name):
    path = WORKSPACE / project_name / '.notes.json'
    if path.exists():
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {'project': project_name, 'files': {}}


def save_notes(project_name, notes):
    path = WORKSPACE / project_name / '.notes.json'
    notes['last_updated'] = datetime.now().isoformat()[:16]
    path.write_text(json.dumps(notes, indent=2, ensure_ascii=False), encoding='utf-8')


def render_markdown(text):
    processor = md_lib.Markdown(extensions=MD_EXT)
    return processor.convert(text)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html', projects=get_projects())


@app.route('/<project>/')
def project_view(project):
    project_dir = WORKSPACE / project
    if not project_dir.is_dir() or project in SKIP_DIRS:
        abort(404)
    files    = get_md_files(project)
    notes    = load_notes(project)
    # Annotate each file entry with its note counts
    file_notes = notes.get('files', {})
    for f in files:
        fn = file_notes.get(f['path'], {})
        f['annotations'] = len(fn.get('annotations', []))
        f['completed']   = len(fn.get('completed_sections', []))
    return render_template('project.html', project=project, files=files)


@app.route('/<project>/view/<path:filepath>')
def viewer(project, filepath):
    file_path = WORKSPACE / project / filepath
    if not file_path.exists() or file_path.suffix != '.md':
        abort(404)
    raw        = file_path.read_text(encoding='utf-8')
    html       = render_markdown(raw)
    notes      = load_notes(project)
    file_notes = notes.get('files', {}).get(filepath, {
        'annotations': [], 'completed_sections': []
    })
    return render_template(
        'viewer.html',
        project    = project,
        filepath   = filepath,
        filename   = file_path.name,
        content    = html,
        notes_json = json.dumps(file_notes, ensure_ascii=False),
    )


# ── API ──────────────────────────────────────────────────────────────────────

@app.route('/api/<project>/notes', methods=['GET'])
def api_get_notes(project):
    return jsonify(load_notes(project))


@app.route('/api/<project>/notes', methods=['POST'])
def api_update_notes(project):
    data     = request.get_json(force=True)
    filepath = data.get('filepath')
    action   = data.get('action')
    if not filepath or not action:
        return jsonify({'error': 'filepath and action required'}), 400

    notes = load_notes(project)
    notes.setdefault('files', {}).setdefault(filepath, {
        'annotations': [], 'completed_sections': []
    })
    file_data = notes['files'][filepath]

    if action == 'add_annotation':
        file_data['annotations'].append({
            'id':            str(uuid.uuid4())[:8],
            'selected_text': data.get('selected_text', ''),
            'note':          data.get('note', ''),
            'section':       data.get('section', ''),
            'created':       datetime.now().isoformat()[:16],
            'color':         data.get('color', 'yellow'),
            'occurrence':    data.get('occurrence', 0),
        })

    elif action == 'delete_annotation':
        aid = data.get('id')
        file_data['annotations'] = [a for a in file_data['annotations'] if a['id'] != aid]

    elif action == 'resolve_annotation':
        aid = data.get('id')
        for ann in file_data.get('annotations', []):
            if ann['id'] == aid:
                ann['status'] = 'resolved' if ann.get('status') != 'resolved' else 'open'
                break

    elif action == 'toggle_section':
        section   = data.get('section', '')
        completed = file_data.setdefault('completed_sections', [])
        if section in completed:
            completed.remove(section)
        else:
            completed.append(section)

    save_notes(project, notes)
    return jsonify({'status': 'ok', 'file_data': file_data})


if __name__ == '__main__':
    debug = os.environ.get('MDVIEWER_DEBUG', 'false').lower() != 'false'
    print(f"Workspace : {WORKSPACE}")
    print(f"Port      : {PORT}")
    print(f"Projects  : {[p['name'] for p in get_projects()]}")
    app.run(debug=debug, port=PORT, use_reloader=debug)
