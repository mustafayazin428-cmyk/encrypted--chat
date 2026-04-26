from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
import base64
import sqlite3

app = Flask(__name__, static_folder='frontend', static_url_path='')
app.config['SECRET_KEY'] = 'secret-key-change-this'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')

DB_PATH = 'chat.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            private_key TEXT NOT NULL,
            public_key TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS aes_keys (
            owner TEXT NOT NULL,
            from_user TEXT NOT NULL,
            aes_key TEXT NOT NULL,
            PRIMARY KEY (owner, from_user)
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            encrypted_message TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    ''')
    conn.commit()
    conn.close()

init_db()

def generate_rsa_keys():
    key = RSA.generate(2048)
    return key.export_key('PEM'), key.publickey().export_key('PEM')

def decrypt_aes_key(private_key_pem, encrypted_aes_key):
    key = RSA.import_key(private_key_pem)
    cipher = PKCS1_OAEP.new(key)
    return cipher.decrypt(encrypted_aes_key)

@app.route('/')
def index():
    return send_from_directory('frontend', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('frontend', path)

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').strip()
    if not username:
        return jsonify({'error': 'اسم المستخدم فارغ'}), 400

    conn = get_db()
    existing = conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'الاسم مستخدم'}), 400

    private_key, public_key = generate_rsa_keys()
    conn.execute(
        'INSERT INTO users (username, private_key, public_key) VALUES (?, ?, ?)',
        (username, private_key.decode('utf-8'), public_key.decode('utf-8'))
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'public_key': public_key.decode('utf-8')})

@app.route('/get_users', methods=['GET'])
def get_users():
    conn = get_db()
    rows = conn.execute('SELECT username FROM users').fetchall()
    conn.close()
    return jsonify({'users': [r['username'] for r in rows]})

@app.route('/get_public_key/<username>', methods=['GET'])
def get_public_key(username):
    conn = get_db()
    row = conn.execute('SELECT public_key FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'المستخدم غير موجود'}), 404
    return jsonify({'public_key': row['public_key']})

@app.route('/exchange_aes_key', methods=['POST'])
def exchange_aes_key():
    data = request.json
    to_user = data.get('to_user')
    from_user = data.get('from_user')
    encrypted_aes_key_b64 = data.get('encrypted_aes_key')

    conn = get_db()
    row = conn.execute('SELECT private_key FROM users WHERE username = ?', (to_user,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'المستخدم غير موجود'}), 404

    encrypted_key = base64.b64decode(encrypted_aes_key_b64)
    aes_key = decrypt_aes_key(row['private_key'].encode('utf-8'), encrypted_key)
    aes_key_b64 = base64.b64encode(aes_key).decode('utf-8')

    conn.execute(
        'INSERT OR REPLACE INTO aes_keys (owner, from_user, aes_key) VALUES (?, ?, ?)',
        (to_user, from_user, aes_key_b64)
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/get_aes_key/<username>/<from_user>', methods=['GET'])
def get_aes_key(username, from_user):
    conn = get_db()
    row = conn.execute(
        'SELECT aes_key FROM aes_keys WHERE owner = ? AND from_user = ?',
        (username, from_user)
    ).fetchone()
    conn.close()
    return jsonify({'aes_key': row['aes_key'] if row else None})

@app.route('/send_message', methods=['POST'])
def send_message():
    data = request.json
    from_user = data.get('from')
    to_user = data.get('to')
    encrypted_message = data.get('encrypted_message')
    timestamp = data.get('timestamp')

    conn = get_db()
    conn.execute(
        'INSERT INTO messages (from_user, to_user, encrypted_message, timestamp) VALUES (?, ?, ?, ?)',
        (from_user, to_user, encrypted_message, timestamp)
    )
    conn.commit()
    conn.close()

    socketio.emit('new_message', {
        'from': from_user,
        'encrypted_message': encrypted_message,
        'timestamp': timestamp
    }, room=to_user)

    return jsonify({'success': True})

@app.route('/get_messages/<username>', methods=['GET'])
def get_messages(username):
    conn = get_db()
    rows = conn.execute(
        'SELECT from_user, encrypted_message, timestamp FROM messages WHERE to_user = ? ORDER BY id ASC',
        (username,)
    ).fetchall()
    conn.close()
    return jsonify({'messages': [dict(r) for r in rows]})

@app.route('/clear_messages/<username>', methods=['POST'])
def clear_messages(username):
    conn = get_db()
    conn.execute('DELETE FROM messages WHERE to_user = ?', (username,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@socketio.on('join')
def on_join(data):
    username = data.get('username')
    if username:
        join_room(username)
        emit('joined', {'status': 'ok', 'room': username})

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000)
