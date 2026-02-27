#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Servo.h>

const char* ssid = "Abcd";
const char* password = "piforcamera";

ESP8266WebServer server(80);

Servo servo1;
Servo servo2;

#define SERVO1_PIN D4
#define SERVO2_PIN D6

// ----------- FUNCTION TO MOVE SERVO -------------
void moveServo(int motor, int angle) {

  if (angle < 0 || angle > 180) return;

  if (motor == 1) {
    servo1.write(angle);
    Serial.println("Motor 1 moved to " + String(angle));
  }
  else if (motor == 2) {
    servo2.write(angle);
    Serial.println("Motor 2 moved to " + String(angle));
  }
}

// ----------- WEB CONTROL HANDLER -------------
void handleControl() {

  int motor = server.arg("motor").toInt();
  int angle = server.arg("angle").toInt();

  moveServo(motor, angle);

  server.send(200, "text/plain", "OK");
}

// ---------------- SETUP ----------------
void setup() {

  Serial.begin(115200);

  servo1.attach(SERVO1_PIN, 500, 2500);
  servo2.attach(SERVO2_PIN, 500, 2500);

  delay(500);

  servo1.write(90);
  servo2.write(80);

// Set Static IP
// Set Static IP (must match your network)
IPAddress local_IP(10,194,106,200);   // choose free number
IPAddress gateway(10,194,106,1);      // usually router IP
IPAddress subnet(255,255,255,0);

WiFi.config(local_IP, gateway, subnet);

WiFi.begin(ssid, password);

Serial.print("Connecting");

while (WiFi.status() != WL_CONNECTED) {
  delay(500);
  Serial.print(".");
}

Serial.println();
Serial.println("Connected Successfully!");
Serial.print("IP Address: ");
Serial.println(WiFi.localIP());

  // Web route
  server.on("/control", handleControl);

  server.begin();

  Serial.println("System Ready");
  Serial.println("Use this format in browser:");
  Serial.println("http://YOUR_IP/control?motor=1&angle=120");
}

// ---------------- LOOP ----------------
void loop() {

  // Handle Web Requests
  server.handleClient();

  // Handle Serial Input
  if (Serial.available() > 0) {

    int motor = Serial.parseInt();
    int angle = Serial.parseInt();

    moveServo(motor, angle);

    delay(300);
  }
}