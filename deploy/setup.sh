#!/usr/bin/env bash
# Sur — one-shot VPS setup (Ubuntu 22.04 / 24.04, Hostinger OK)
# Run INSIDE the unzipped folder:  bash deploy/setup.sh
set -euo pipefail

APP_DIR="/opt/sur"
PORT="5000"

echo "== 1/4 system packages =="
sudo apt update -qq
sudo apt install -y -qq python3 python3-venv curl unzip

echo "== 2/4 copy app to $APP_DIR =="
sudo mkdir -p "$APP_DIR"
sudo cp -r app.py requirements.txt static "$APP_DIR/"
sudo chown -R "$USER:$USER" "$APP_DIR"

echo "== 3/4 python venv + dependencies =="
cd "$APP_DIR"
python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt

echo "== 4/4 systemd service =="
sudo cp "$OLDPWD/deploy/sur.service" /etc/systemd/system/sur.service 2>/dev/null \
  || sudo cp deploy/sur.service /etc/systemd/system/sur.service
sudo sed -i "s/^User=.*/User=$USER/" /etc/systemd/system/sur.service
sudo sed -i "s/^Environment=PORT=.*/Environment=PORT=$PORT/" /etc/systemd/system/sur.service
sudo systemctl daemon-reload
sudo systemctl enable --now sur
sleep 3

echo ""
echo "== status =="
sudo systemctl is-active sur
IP=$(curl -s --max-time 5 ifconfig.me || echo "YOUR_VPS_IP")
echo ""
echo "Done! Open in browser:  http://$IP:$PORT"
echo "Logs:  sudo journalctl -u sur -f"
