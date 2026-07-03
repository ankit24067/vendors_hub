import os

from flask import Flask, send_from_directory

from config import Config


def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.from_object(Config)
    os.makedirs(Config.UPLOAD_DIR, exist_ok=True)

    from app.auth import auth_bp
    from app.api import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    @app.route("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/uploads/<path:name>")
    def uploaded_file(name):
        return send_from_directory(Config.UPLOAD_DIR, name)

    return app
