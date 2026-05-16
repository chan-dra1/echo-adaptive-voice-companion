from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/status')
def status():
    return jsonify({"status": "online", "message": "Mock server for Echo"}), 200

if __name__ == '__main__':
    app.run(port=8000)
