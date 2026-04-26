from gevent import monkey
monkey.patch_all()

from app import socketio, app

if __name__ == '__main__':
    socketio.run(app, debug=False, port=5000)
