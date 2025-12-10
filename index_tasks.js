const BASE_URL = "https://ndb.fut.ru";
const TABLE_ID = "m6tyxd3346dlhco";
const API_KEY = "N0eYiucuiiwSGIvPK5uIcOasZc_nJy6mBUihgaYQ";

const RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
const FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

const SOLUTION_FIELDS = {
    solution1: "c8kqy20i6nvp3ik",
    solution2: "cjfdfiuxe0yaqkh",
    solution3: "cmjhr31sk03zf97"
};

const DATE_FIELD_ID = "cdbi4yxd4blp8gf"; // дата первой загрузки

let currentRecordId = null;
let userPlatform = null;
let rawUserId = null;

const screens = {
    welcome: document.getElementById("welcomeScreen"),
    upload1: document.getElementById("uploadScreen1"),
    upload2: document.getElementById("uploadScreen2"),
    upload3: document.getElementById("uploadScreen3"),
    result: document.getElementById("resultScreen")
};

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (screens[name]) screens[name].classList.remove('hidden');
}

function showError(msg) {
    document.body.innerHTML = `
        <div style="padding:50px;text-align:center;color:white;font-family:sans-serif;">
            <h2>Ошибка</h2>
            <p style="font-size:18px;margin:30px 0;">${msg}</p>
            <button onclick="location.reload()" style="padding:15px 35px;font-size:17px;">Попробовать снова</button>
        </div>`;
}

// Ждём vkBridge — обязательно для VK Mini Apps 2025
async function waitForVkBridge() {
    return new Promise(resolve => {
        if (window.vkBridge) return resolve(window.vkBridge);
        const check = setInterval(() => {
            if (window.vkBridge) {
                clearInterval(check);
                resolve(window.vkBridge);
            }
        }, 50);
        setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
    });
}

// Поиск пользователя по tg-id
async function findUser(id) {
    // Telegram ID
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: 'tg' };
    }

    // VK ID с суффиксом
    const vkValue = id + "_VK";
    res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${vkValue})`, {
        headers: { "xc-token": API_KEY }
    });
    data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: 'vk' };
    }

    return null;
}

// Загрузка одного файла + дата по Москве при первой загрузке
async function uploadSolution(recordId, fieldId, file, isFirst = false) {
    const form = new FormData();
    form.append("file", file);
    form.append("path", "solutions");

    const up = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!up.ok) throw new Error("Не удалось загрузить файл");

    const info = await up.json();
    const fileData = Array.isArray(info) ? info[0] : info;
    const url = fileData.url || `${BASE_URL}/${fileData.path}`;

    const attachment = [{
        title: fileData.title || file.name,
        mimetype: file.type,
        size: file.size,
        url: url
    }];

    const body = {
        Id: Number(recordId),
        [fieldId]: attachment
    };

    // Добавляем дату только при первой загрузке
    if (isFirst) {
        const now = new Date();
        const offset = now.getTimezoneOffset();
        const moscow = new Date(now.getTime() + (180 + offset) * 60 * 1000);
        body[DATE_FIELD_ID] = moscow.toISOString();
    }

    const patch = await fetch(RECORDS_ENDPOINT, {
        method: "PATCH",
        headers: {
            "xc-token": API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!patch.ok) throw new Error("Ошибка сохранения в базу");
}

// Прогресс-бар
async function progress(barId, statusId) {
    const bar = document.getElementById(barId);
    const status = document.getElementById(statusId);
    let p = 0;
    return new Promise(res => {
        const int = setInterval(() => {
            p += 12 + Math.random() * 22;
            if (p >= 100) {
                p = 100;
                clearInterval(int);
                status.textContent = "Готово!";
                res();
            }
            bar.style.width = p + "%";
            status.textContent = `Загрузка ${Math.round(p)}%`;
        }, 110);
    });
}

// =================================== СТАРТ ===================================
(async () => {
    try {
        let found = false;

        // 1. VK
        const bridge = await waitForVkBridge();
        if (bridge) {
            await bridge.send("VKWebAppInit");
            const info = await bridge.send("VKWebAppGetUserInfo");
            rawUserId = info.id;
            userPlatform = "vk";
            found = true;
            console.log("VK пользователь:", rawUserId);
        }

        // 2. Telegram
        if (!found && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            found = true;
            console.log("Telegram пользователь:", rawUserId);
        }

        if (!found) throw new Error("Платформа не поддерживается");

        const user = await findUser(rawUserId);
        if (!user) throw new Error("Вы не зарегистрированы. Напишите в бот");

        currentRecordId = user.recordId;
        userPlatform = user.platform;

        showScreen("welcome");

    } catch (err) {
        console.error(err);
        showError(err.message || "Ошибка запуска");
    }
})();

// =================================== КНОПКИ ===================================
document.getElementById("startUpload")?.addEventListener("click", () => showScreen("upload1"));

async function handle(num, fieldId, nextScreen = null) {
    const input = document.getElementById(`fileInput${num}`);
    const error = document.getElementById(`error${num}`);
    const file = input.files[0];

    error.classList.add("hidden");

    if (!file) return error.textContent = "Выберите файл", error.classList.remove("hidden");
    if (file.size > 15 * 1024 * 1024) return error.textContent = "Файл больше 15 МБ", error.classList.remove("hidden");

    const allowed = ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     "image/png","image/jpeg","image/jpg","image/webp"];
    if (!allowed.includes(file.type)) return error.textContent = "Неподдерживаемый формат", error.classList.remove("hidden");

    try {
        await progress(`progress${num}`, `status${num}`);
        await uploadSolution(currentRecordId, fieldId, file, num === 1);
        nextScreen ? showScreen(nextScreen) : showScreen("result");
    } catch (e) {
        error.textContent = e.message || "Ошибка загрузки";
        error.classList.remove("hidden");
    }
}

document.getElementById("submitFile1")?.addEventListener("click", () => handle(1, SOLUTION_FIELDS.solution1, "upload2"));
document.getElementById("submitFile2")?.addEventListener("click", () => handle(2, SOLUTION_FIELDS.solution2, "upload3"));
document.getElementById("submitFile3")?.addEventListener("click", () => handle(3, SOLUTION_FIELDS.solution3));

document.getElementById("skipFile2")?.addEventListener("click", () => showScreen("result"));
document.getElementById("skipFile3")?.addEventListener("click", () => showScreen("result"));

document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    }
});