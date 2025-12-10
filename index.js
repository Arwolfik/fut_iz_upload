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

// ================== ВСПОМОГАТЕЛЬНЫЕ ==================

function showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    if (screens[name]) {
        screens[name].classList.remove("hidden");
    }
}

function showInlineError(num, msg) {
    const error = document.getElementById(`error${num}`);
    if (!error) return;
    error.textContent = msg;
    error.classList.remove("hidden");
}

function clearInlineError(num) {
    const error = document.getElementById(`error${num}`);
    if (!error) return;
    error.textContent = "";
    error.classList.add("hidden");
}

// Критическая ошибка (только если вообще всё упало)
function showErrorFatal(msg) {
    document.body.className = "";
    document.body.innerHTML = `
        <div style="
            background:#20232a;
            color:#fff;
            min-height:100vh;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:40px 20px;
            box-sizing:border-box;
        ">
            <div>
                <h2>Ошибка</h2>
                <p style="font-size:18px;margin:25px 0;">${msg}</p>
                <button onclick="location.reload()" style="
                    padding:12px 30px;
                    font-size:16px;
                    border-radius:8px;
                    border:none;
                    cursor:pointer;
                ">
                    Попробовать снова
                </button>
            </div>
        </div>
    `;
}

// Поиск пользователя по tg-id (с поддержкой _VK)
async function findUser(id) {
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "tg" };
    }

    const vkValue = id + "_VK";
    res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${vkValue})`, {
        headers: { "xc-token": API_KEY }
    });
    data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "vk" };
    }

    return null;
}

// Загрузка одного файла + запись даты при первой загрузке
async function uploadSolution(recordId, fieldId, file, isFirst = false) {
    if (!recordId) {
        throw new Error("Техническая ошибка: не найдена запись пользователя в базе.");
    }

    const form = new FormData();
    form.append("file", file);
    form.append("path", "solutions");

    const up = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!up.ok) throw new Error("Не удалось загрузить файл на сервер.");

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

    if (!patch.ok) {
        const errText = await patch.text();
        console.error("PATCH error:", errText);
        throw new Error("Ошибка сохранения в базу.");
    }
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

// ================== СТАРТ ==================

(async () => {
    try {
        // сразу показываем welcome, чтобы не было белого экрана
        showScreen("welcome");

        // 1. Telegram (часто удобнее тестировать из tg)
        if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            try {
                tg.ready();
                tg.expand();
            } catch (e) {
                console.log("Telegram ready/expand error:", e);
            }
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            console.log("Telegram пользователь:", rawUserId);
        }
        // 2. Если не Telegram — пробуем VK Mini Apps через vkBridge
        else if (window.vkBridge) {
            try {
                await window.vkBridge.send("VKWebAppInit");
                const info = await window.vkBridge.send("VKWebAppGetUserInfo");
                if (info && info.id) {
                    rawUserId = info.id;
                    userPlatform = "vk";
                    console.log("VK пользователь:", rawUserId);
                }
            } catch (vkErr) {
                console.log("VK Bridge недоступен или ошибка VKWebAppInit:", vkErr);
            }
        }

        if (!rawUserId) {
            // не Telegram и не VK — значит, запустили не там
            showErrorFatal("Откройте приложение из Telegram-бота или VK Mini Apps.");
            return;
        }

        // 3. Ищем пользователя в базе
        try {
            const user = await findUser(rawUserId);
            if (!user) {
                alert("Вы не зарегистрированы. Напишите в бот, чтобы привязать аккаунт.");
                // Можно тут задизейблить кнопку начала загрузки, чтобы не было лишних вопросов
                const startBtn = document.getElementById("startUpload");
                if (startBtn) startBtn.disabled = true;
                return;
            }

            currentRecordId = user.recordId;
            userPlatform = user.platform;
            console.log("Найдена запись в базе:", currentRecordId, userPlatform);
        } catch (dbErr) {
            console.error("Ошибка при поиске пользователя:", dbErr);
            alert("Не удалось получить данные пользователя. Попробуйте позже.");
        }
    } catch (err) {
        console.error("Критическая ошибка запуска:", err);
        showErrorFatal("Критическая ошибка запуска приложения.");
    }
})();

// ================== КНОПКИ ===================

document.getElementById("startUpload")?.addEventListener("click", () => {
    showScreen("upload1");
});

async function handle(num, fieldId, nextScreen = null) {
    const input = document.getElementById(`fileInput${num}`);
    const file = input.files[0];

    clearInlineError(num);

    if (!file) {
        showInlineError(num, "Выберите файл.");
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        showInlineError(num, "Файл больше 15 МБ.");
        return;
    }

    const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp"
    ];

    if (!allowed.includes(file.type)) {
        showInlineError(num, "Неподдерживаемый формат файла.");
        return;
    }

    try {
        await progress(`progress${num}`, `status${num}`);
        await uploadSolution(currentRecordId, fieldId, file, num === 1);
        if (nextScreen) {
            showScreen(nextScreen);
        } else {
            showScreen("result");
        }
    } catch (e) {
        console.error("Ошибка загрузки:", e);
        showInlineError(num, e.message || "Ошибка загрузки.");
    }
}

document.getElementById("submitFile1")?.addEventListener("click", () =>
    handle(1, SOLUTION_FIELDS.solution1, "upload2")
);
document.getElementById("submitFile2")?.addEventListener("click", () =>
    handle(2, SOLUTION_FIELDS.solution2, "upload3")
);
document.getElementById("submitFile3")?.addEventListener("click", () =>
    handle(3, SOLUTION_FIELDS.solution3)
);

document.getElementById("skipFile2")?.addEventListener("click", () => {
    showScreen("result");
});
document.getElementById("skipFile3")?.addEventListener("click", () => {
    showScreen("result");
});

document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        window.vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    } else {
        window.close();
    }
});
