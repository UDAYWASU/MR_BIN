import tensorflow as tf
import numpy as np
from tensorflow import image

# ==============================
# LOAD MODEL ONCE (GLOBAL)
# ==============================

MODEL_PATH = r"C:\Users\LOQ\Documents\code\SBIn\Action\waste_classifier_model.h5"
IMG_SIZE = (224, 224)
class_names = ['mixed', 'organic', 'paper', 'plastic']

print("🔵 Loading AI model...")

model = tf.keras.models.load_model(
    MODEL_PATH,
    compile=False
)

print("✅ Model loaded successfully!")


def classify_image(img_path):
    try:
        img = image.load_img(img_path, target_size=IMG_SIZE)
        img_array = image.img_to_array(img)
        img_array = np.expand_dims(img_array, axis=0)

        predictions = model.predict(img_array, verbose=0)

        confidence = float(np.max(predictions))
        predicted_class = class_names[np.argmax(predictions)]

        print("♻ Category:", predicted_class)
        print("📊 Confidence:", round(confidence * 100, 2), "%")

        return predicted_class, confidence

    except Exception as e:
        print("❌ Classification error:", e)
        return None, None


def monitor_center():
    global latest_frame

    prev_gray = None
    last_trigger_time = 0

    print("🟢 Monitoring center region...")

    while True:
        with lock:
            if latest_frame is None:
                time.sleep(0.01)
                continue
            frame = latest_frame.copy()

        frame_small = cv2.resize(frame, (PROCESS_WIDTH, PROCESS_HEIGHT))
        gray = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY)

        if prev_gray is None:
            prev_gray = gray
            continue

        h, w = gray.shape
        cx, cy = w // 2, h // 2

        x1 = cx - ROI_SIZE // 2
        y1 = cy - ROI_SIZE // 2
        x2 = cx + ROI_SIZE // 2
        y2 = cy + ROI_SIZE // 2

        roi_prev = prev_gray[y1:y2, x1:x2]
        roi_curr = gray[y1:y2, x1:x2]

        diff = cv2.absdiff(roi_prev, roi_curr)
        diff = cv2.GaussianBlur(diff, (5, 5), 0)
        _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)

        change_pixels = np.sum(thresh) / 255
        current_time = time.time()

        if change_pixels > PIXEL_THRESHOLD and (current_time - last_trigger_time > COOLDOWN_SECONDS):
            print("\n🗑 Trash Detected! Waiting 500ms...")

            last_trigger_time = current_time

            # Wait for object to settle
            time.sleep(0.5)

            with lock:
                stable_frame = latest_frame.copy()

            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"snapshot_{timestamp}.jpg"

            cv2.imwrite(filename, stable_frame)
            print("📸 Snapshot saved:", filename)

            # 🔥 CLASSIFY IMAGE
            predicted_class, confidence = classify_image(filename)

            if predicted_class:
                print("🚀 FINAL CATEGORY:", predicted_class.upper())

        prev_gray = gray
        time.sleep(0.01)