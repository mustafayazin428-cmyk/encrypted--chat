from gevent import monkey
monkey.patch_all()

from backend.app import socketio, app

if __name__ == '__main__':
    print("✅ Server running on http://localhost:5000")
    socketio.run(app, debug=False, port=5000)