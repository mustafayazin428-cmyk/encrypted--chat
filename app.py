from flask import Flask, render_template, request, redirect, jsonify
import os

app = Flask(__name__)

messages = []


@app.route("/", methods=["GET", "POST"])
def chat():

    if request.method == "POST":

        username = request.form.get("username")
        receiver = request.form.get("receiver")
        message = request.form.get("message")

        print("POST DATA:", username, receiver, message)

        if username and receiver and message:

            messages.append({
                "sender": username,
                "receiver": receiver,
                "message": message
            })

        print("MESSAGES:", messages)

        return redirect("/")

    return render_template("chat.html")


@app.route("/messages/<username>")
def get_messages(username):

    result = []

    for m in messages:
        if m["receiver"] == username:
            result.append(m)

    return jsonify(result)


# 🚀 مهم جداً للنشر على Render
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)