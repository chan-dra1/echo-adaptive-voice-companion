
# server.py - Local Voice Cloning & TTS Server
# Requirements: pip install -r requirements.txt
# Run with: python server.py

from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from TTS.api import TTS
import os
import io
import base64
import uuid

app = Flask(__name__)
CORS(app)

# Configuration
# Using XTTS-v2 for best multilingual & cloning performance
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
OUTPUT_DIR = "server_data/generated"
UPLOAD_DIR = "server_data/uploads"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

print("⏳ Loading Coqui TTS Model... (This downloads ~3GB on first run)")
device = "cuda" if os.getenv("USE_GPU") == "1" else "cpu"
try:
    tts = TTS(MODEL_NAME).to(device)
    print(f"✅ Model Loaded on {device}!")
except Exception as e:
    print(f"❌ Failed to load model: {e}")
    tts = None

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        "status": "online" if tts else "error", 
        "model": MODEL_NAME,
        "device": device
    })

@app.route('/synthesize', methods=['POST'])
def synthesize():
    if not tts:
        return jsonify({"error": "Model not loaded"}), 500

    data = request.json
    text = data.get('text')
    ref_audio_base64 = data.get('reference_audio') # Base64 string of WAV/MP3
    language = data.get('language', 'en')

    if not text or not ref_audio_base64:
        return jsonify({"error": "Missing text or reference audio"}), 400

    try:
        # 1. Decode Reference Audio
        ref_audio_data = base64.b64decode(ref_audio_base64.split(',')[1] if ',' in ref_audio_base64 else ref_audio_base64)
        ref_id = str(uuid.uuid4())
        ref_path = os.path.join(UPLOAD_DIR, f"{ref_id}.wav")
        with open(ref_path, "wb") as f:
            f.write(ref_audio_data)

        # 2. Generate Speech
        out_id = str(uuid.uuid4())
        output_path = os.path.join(OUTPUT_DIR, f"{out_id}.wav")
        
        tts.tts_to_file(
            text=text,
            file_path=output_path,
            speaker_wav=ref_path,
            language=language
        )

        # 3. Cleanup Reference (Optional - keeping for debugging for now)
        # os.remove(ref_path)

        return send_file(output_path, mimetype="audio/wav")

    except Exception as e:
        print(f"Synthesis Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- Ghost Agent Capabilities ---

def is_safe_path(path):
    # Basic sandbox: Ensure path is within the current working directory
    base_dir = os.path.abspath(os.getcwd())
    target_path = os.path.abspath(path)
    return os.path.commonpath([base_dir, target_path]) == base_dir

@app.route('/fs/list', methods=['POST'])
def list_files():
    data = request.json
    path = data.get('path', '.')
    
    if not is_safe_path(path):
        return jsonify({"error": "Access denied"}), 403
        
    try:
        files = []
        for root, dirs, filenames in os.walk(path):
            # Skip hidden folders and venv/node_modules
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', 'venv', '__pycache__']]
            for f in filenames:
                if not f.startswith('.'):
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, start=os.getcwd())
                    files.append(rel_path)
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/fs/read', methods=['POST'])
def read_file():
    data = request.json
    path = data.get('path')
    
    if not path or not is_safe_path(path):
        return jsonify({"error": "Invalid or unsafe path"}), 400
        
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({"content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/fs/write', methods=['POST'])
def write_file():
    data = request.json
    path = data.get('path')
    content = data.get('content')
    
    if not path or content is None or not is_safe_path(path):
        return jsonify({"error": "Invalid parameters or unsafe path"}), 400
        
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"status": "success", "path": path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/system/exec', methods=['POST'])
def exec_command():
    import subprocess
    data = request.json
    command = data.get('command')
    cwd = data.get('cwd', os.getcwd())
    
    if not command:
        return jsonify({"error": "No command provided"}), 400
        
    try:
        print(f"👻 Ghost Agent Executing: {command}")
        result = subprocess.run(
            command, 
            shell=True, 
            cwd=cwd, 
            capture_output=True, 
            text=True,
            timeout=30 # Safety timeout
        )
        return jsonify({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        })
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Command timed out"}), 408
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("🚀 Local Voice Server running on http://localhost:8000")
    app.run(port=8000, debug=True)
