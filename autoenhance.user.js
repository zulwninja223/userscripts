// ==UserScript==
// @name         Auto ulepszanie EQ
// @namespace    http://tampermonkey.net/
// @version      1.05
// @description  Automatyczne wpalanie przedmiotów w oknie Rzemiosła
// @author       You
// @match        https://*.margonem.pl/
// @exclude      https://www.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @downloadURL  https://github.com/zulwninja223/userscripts/raw/refs/heads/main/autoenhance.user.js
// @updateURL    https://github.com/zulwninja223/userscripts/raw/refs/heads/main/autoenhance.user.js
// @grant        GM_registerMenuCommand
// ==/UserScript==

const window = unsafeWindow;

window.bB = () => {};

const { message, $ } = window;

const rarity = { common: 0, unique: 1, heroic: 2 };

const CHUNK_LIMIT = 25;

const classGroup = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 1,
  7: 1,
  29: 1,
  8: 2,
  9: 2,
  10: 2,
  11: 2,
  14: 2,
  12: 3,
  13: 3,
};

const Utils = {
  toChunks(arr, size) {
    const result = [];
    const copy = [...arr];
    while (copy.length > 0) {
      result.push(copy.splice(0, size));
    }
    return result;
  },

  getMargonemDay() {
    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setHours(5, 25, 0, 0);
    const targetDate =
      now < resetTime ? new Date(now.setDate(now.getDate() - 1)) : now;
    return `${String(targetDate.getDate()).padStart(2, "0")}/${String(
      targetDate.getMonth() + 1
    ).padStart(2, "0")}/${targetDate.getFullYear()}`;
  },

  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  isNI() {
    return typeof window.Engine == "object";
  },

  getItems() {
    return this.isNI()
      ? window.Engine.items.fetchLocationItems("g")
      : Object.values(window.g.item).filter((e) => e.loc == "g");
  },

  getBagItems() {
    return this.getItems().filter((e) => e.st == 0);
  },

  getHero() {
    return this.isNI() ? window.Engine.hero.d : window.hero;
  },

  getItemById(id) {
    return this.isNI()
      ? window.Engine.items.getItemById(id)
      : window.g.item[id];
  },

  getDisableManager() {
    return this.isNI()
      ? window.Engine.disableItemsManager
      : window.g.disableItemsManager;
  },

  startItemKindDisable() {
    const key = this.isNI() ? Engine.itemsDisableData.ENHANCE : "enhance";
    this.getDisableManager().startSpecificItemKindDisable(key);
  },

  endItemKindDisable() {
    const key = this.isNI() ? Engine.itemsDisableData.ENHANCE : "enhance";
    this.getDisableManager().endSpecificItemKindDisable(key);
  },

  getStatParser() {
    return this.isNI()
      ? window.Engine.items.parseItemStat
      : window.parseItemStat;
  },

  getCraftingWindow() {
    return this.isNI() ? window.Engine.crafting.window : window.g.crafting.window;
  },

  getLock() {
    return this.isNI() ? window.Engine.lock : window.g.lock;
  },

  getFreeSlots() {
    return this.isNI()
      ? window.Engine.heroEquipment.getFreeSlots()
      : window.g.freeSlots;
  },

  isDead() {
    return this.isNI() ? window.Engine.lock : window.g.dead;
  },

  lock(key) {
    this.getLock().add(key);
  },

  unlock(key) {
    this.getLock().remove(key);
  },

  isLocked() {
    return this.getLock().length > 0 && this.isDead();
  },

  getElement() {
    return this.isNI()
      ? document.querySelector(".widget-photo")
      : document.getElementById("b_recipes");
  },

  copyItem(id) {
    return this.isNI()
      ? window.Engine.items.createViewIcon(
          id,
          window.Engine.itemsViewData.ENHANCE_ITEM_VIEW
        )[0][0]
      : $(`#item${id}`).clone(!1)[0];
  },

  clickHandler(clb_obj) {
    if (this.isNI()) {
      const defaultClick = window.Engine.heroEquipment.afterOneClick;
      const defaultEQClick = window.Engine.heroEquipment.afterOnClickEq;

      window.Engine.heroEquipment.afterOneClick = (t, e) => {
        if (!clb_obj.isOpened()) return defaultClick(t, e);
        if (e && !itemIsDisabled(e)) {
          clb_obj.selectItem(t.id);
        }
      };

      window.Engine.heroEquipment.afterOnClickEq = (t, e) => {
        if (!clb_obj.isOpened()) return defaultEQClick(t, e);
        if (e && !itemIsDisabled(e)) {
          clb_obj.selectItem(t.id);
        }
      };
    } else {
      document.getElementById("panel").addEventListener("contextmenu", (e) => {
        if (!clb_obj.isOpened()) return;
        e.preventDefault();
        const item = e.target.closest(".item:not(.enhance-disable)");
        item && clb_obj.selectItem(item.id.substr(4));
      });
    }
  },
  wrapFunction(originalFn, targetObj, propName, clb_obj) {
    if (typeof originalFn === "function") {
      const original = originalFn;

      targetObj[propName] = function (...args) {
        const res = original.apply(this, args);
        clb_obj.check();
        return res;
      };
    }
  },

  getItemId(element) {
    const idClass = Array.from(element.classList).find((cls) =>
      cls.startsWith("item-id-")
    );
    if (idClass) {
      return idClass.replace("item-id-", "");
    }
    return null;
  },
};

class EnhanceManager {
  constructor(account, char) {
    this.limitKey = `enhance-limit-${account}`;
    this.configKey = `auto_enhance-${char}`;
    this.opened = false;
  }

  loadConfig() {
    try {
      const config = localStorage.getItem(this.configKey);
      return config
        ? JSON.parse(config)
        : { itemId: 0, maxRarity: 0, freeSlots: 5, onlyMatchingCl: false };
    } catch (error) {
      message("Brak konfiguracji. Użyto domyślnych ustawień.");
      return { itemId: 0, maxRarity: 0, freeSlots: 5, onlyMatchingCl: false };
    }
  }

  saveConfig() {
    const freeSlots = parseInt(this.freeSlotsInput.value, 10);
    if (isNaN(freeSlots)) {
      message("ERROR: Invalid free slots value");
      return;
    }
    this.config = {
      itemId: Utils.isNI()
        ? Utils.getItemId(this.itemSlot.firstChild)
        : this.itemSlot.firstChild?.id?.substr(4) || 0,
      maxRarity: this.raritySelector.selectedIndex,
      freeSlots,
      onlyMatchingCl: this.onlyMatchingCl.checked,
    };
    localStorage.setItem(this.configKey, JSON.stringify(this.config));
    message("Zapisano");
    this.check();
  }

  isOpened() {
    return this.opened;
  }

  checkRarity(rarityValue, itemClass) {
    if (this.config.onlyMatchingCl && rarityValue > rarity.common) {
      return (
        classGroup[itemClass] === classGroup[this.getSelectedItemClass()] &&
        rarityValue <= this.config.maxRarity
      );
    }
    return rarityValue <= this.config.maxRarity;
  }

  getSelectedItemClass() {
    return Utils.getItemById(this.config.itemId).cl;
  }

  getItems() {
    const items = [];
    const bagItems = Utils.getBagItems();

    if (!bagItems) {
      message("ERROR: No items");
      return items;
    }

    for (const { id, cl, stat, enhancementPoints } of bagItems) {
      if (id == this.config.itemId || enhancementPoints == undefined) continue;

      const stats = Utils.getStatParser()(stat);
      if (
        this.checkRarity(rarity[stats.rarity], cl) &&
        !stats.hasOwnProperty("artisan") &&
        !stats.hasOwnProperty("enhancement_upgrade_lvl") &&
        stats.hasOwnProperty("binds")
      ) {
        items.push(id);
      }
    }
    return items;
  }

  checkDay() {
    const date = localStorage.getItem(this.limitKey);
    return date ? date === Utils.getMargonemDay() : false;
  }

  setDayLimitFinished() {
    localStorage.setItem(this.limitKey, Utils.getMargonemDay());
  }

  async upgradeItem() {
    try {
      const items = this.getItems();
      if (items.length === 0) {
        return;
      }
      Utils.lock("hard-lock");
      await this.performEnhancement(items);
    } catch (error) {
      message(`Błąd ulepszania: ${error.message}`);
    } finally {
      Utils.unlock("hard-lock");
      Utils.getCraftingWindow().close();
    }
  }

  async performEnhancement(items) {
    await new Promise((resolve, reject) => {
      _g("artisanship&action=open", (response) => {
        if (!response?.artisanship) {
          reject(new Error("Brak odpowiedzi z rzemiosła."));
          return;
        }
        const { count, limit } = response.enhancement.usages_preview;
        const limitLeft = limit - count;
        if (limitLeft === 0) {
          this.setDayLimitFinished();
          this.updateCounter("Limit dzienny osiągnięty.");
          resolve();
          return;
        }
        const selectedItems = items.slice(0, limitLeft);
        const chunks = Utils.toChunks(selectedItems, CHUNK_LIMIT);
        this.processChunks(chunks, resolve, reject);
      });
    });
  }

  async processChunks(chunks, resolve, reject) {
    for (const chunk of chunks) {
      await new Promise((res) => {
        _g(
          `enhancement&action=progress&item=${
            this.config.itemId
          }&ingredients=${chunk.toString()}`,
          (response) => {
            if (!response.enhancement) {
              reject(new Error("Brak odpowiedzi ulepszania."));
              return;
            }
            const { current, max } = response.enhancement.progressing;
            const { name } = Utils.getItemById(this.config.itemId);
            const { count, limit } = response.enhancement.usages_preview;
            message(`${name} [${current}/${max}] (${count}/${limit})`);
            if (count >= limit) {
              this.setDayLimitFinished();
              this.updateCounter("Limit dzienny osiągnięty.");
            } else {
              this.updateCounter(`${count}/${limit}`);
            }
            res();
          }
        );
      });
      await new Promise((res) => setTimeout(res, 200));
    }
    resolve();
  }

  updateCounter(messageText) {
    const counter = this.window.querySelector("#auto-enhance-counter");
    counter.textContent = messageText || "";
  }

  init() {
    this.config = this.loadConfig();

    this.mainEl = Utils.getElement();
    this.mainEl.oncontextmenu = (e) => this.openWindow(e);

    this.window = this.getHTML()[0];
    this.window.style.display = "none";
    this.raritySelector = this.window.querySelector("select");
    this.freeSlotsInput = this.window.querySelector("input");
    this.onlyMatchingCl = this.window.querySelector("#onlyMatchingCl");
    this.itemSlot = this.window.querySelector("#selected-item");

    const saveButton = this.window.querySelector("#save-button");
    saveButton.onclick = () => this.saveConfig();

    const useButton = this.window.querySelector("#use-button");
    useButton.onclick = () => {
      this.check(1);
      this.closeWindow();
    };

    const closeButton = this.window.querySelector("#close-button");
    closeButton.onclick = () => this.closeWindow();

    document.head.insertAdjacentHTML(
      "beforeend",
      `<style>
            #auto-enhance {
                position: fixed;
                width: 250px;
                box-sizing: border-box;
                height: 275px;
                padding: 8px;
                background: rgba(33, 31, 31, 0.76);
                border-radius: 10px;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                backdrop-filter: blur(6.2px);
                -webkit-backdrop-filter: blur(6.2px);
                border: 2px solid rgb(41, 133, 48);
                top: 50%;
                left: 50%;
                z-index: 500;
                color: rgb(30, 229, 45);
                transform: translate(-50%, -50%);
                font-size: 12px;
            }
            #selected-item {
                width: 32px;
                height: 32px;
                background-color: #0B3201;
                margin: 5px auto;
            }
            #auto-enhance-footer {
                position: absolute;
                bottom: 0;
                text-align: center;
                left: 0;
                right: 0;
                display: flex;
                flex-wrap: wrap;
                padding: 10px;
                row-gap: 10px;
                column-gap: 15px;
                justify-content: center;
            }
            #auto-enhance-counter {
                text-align: center;
                font-size: 15px;
                padding: 15px;
            }
            #auto-enhance-footer button {
                border: 1px solid #298530;
                padding: 5px;
                color: #1ede2c;
                flex: 1;
                background: none;
            }
            #auto-enhance select, #auto-enhance input {
                border: 1px solid #298530;
                color: #1ede2c;
                width: 100%;
                background: none;
                margin: 5px 0;
                box-sizing: border-box;
            }
        </style>`
    );

    document.body.appendChild(this.window);

    this.check = Utils.debounce(this.check.bind(this), 300);
    this.check();
  }

  check(ignoreSlots) {
    if (this.checkDay()) {
      this.updateCounter("Limit dzienny osiągnięty.");
      return;
    }
    if (Utils.getItemById(this.config.itemId)?.loc != "g") {
      return;
    }

    if (Utils.isLocked()) return;
    if (ignoreSlots || Utils.getFreeSlots() <= this.config.freeSlots) {
      this.upgradeItem();
    }
  }

  selectItem(id) {
    if (
      Utils.getStatParser()(Utils.getItemById(id).stat)
        .enhancement_upgrade_lvl === 5
    ) {
      message("Przedmiot jest w pełni ulepszony");
      return;
    }
    this.selectedItemView(id);
  }

  deselectItem(e) {
    e.preventDefault();
    this.itemSlot.innerHTML = "";
  }

  selectedItemView(id) {
    const copyItem = Utils.copyItem(id);

    copyItem.style.top = null;
    copyItem.style.left = null;
    copyItem.classList.add("copy");
    copyItem.onclick = (e) => this.deselectItem(e);

    this.itemSlot.innerHTML = "";
    this.itemSlot.appendChild(copyItem);
  }

  getHTML() {
    return $(`
            <div id="auto-enhance">
                <div id="selected-item"></div>
                <div>Maksymalna rzadkość wpalanych itemów<select>
                    <option>Zwykłe</option>
                    <option>Unikatowe</option>
                    <option>Heroiczne</option>
                </select></div>
                <div>Liczba wolnych miejsc w torbie<input type="number"></div>
                <div><input type="checkbox" id="onlyMatchingCl" style="width: 15px;height: 15px;vertical-align: middle;"/> Niepospolite muszą pasować typem</div>
                <div id="auto-enhance-counter"></div>
                <div id="auto-enhance-footer">
                    <button class="enhance-button" id="save-button">Zapisz</button>
                    <button class="enhance-button" id="use-button">Ulepsz</button>
                    <button class="enhance-button" id="close-button" style="flex: 0 0 100%;">Zamknij</button>
                </div>
            </div>
        `);
  }

  openWindow(e) {
    if (e) e.preventDefault();
    this.opened = true;
    this.window.style.display = "block";
    Utils.startItemKindDisable();
    this.raritySelector.selectedIndex = this.config.maxRarity;
    this.freeSlotsInput.value = this.config.freeSlots;
    this.onlyMatchingCl.checked = this.config.onlyMatchingCl;
    if (this.config.itemId && Utils.getItemById(this.config.itemId)) {
      this.selectedItemView(this.config.itemId);
    }
  }

  closeWindow() {
    this.opened = false;
    this.window.style.display = "none";
    Utils.endItemKindDisable();
  }
}

let enhanceManager = false;
function startManager() {
  const { account, id } = Utils.getHero();
  enhanceManager = new EnhanceManager(account, id);
  enhanceManager.init();

  Utils.clickHandler(enhanceManager);

  if (Utils.isNI()) {
    Utils.wrapFunction(
      window.Engine.items.afterUpdate,
      window.Engine.items,
      "afterUpdate",
      enhanceManager
    );
  } else {
    Utils.wrapFunction(window.newItem, window, "newItem", enhanceManager);
  }
}

GM_registerMenuCommand("Otwórz konfigurację", () => {
  if (!enhanceManager) {
    return message("Poczekaj na zainicjowanie interfejsu");
  }
  enhanceManager.openWindow();
});

if (Utils.isNI())
  window.API.addCallbackToEvent(
    window.Engine.apiData.AFTER_INTERFACE_START,
    startManager
  );
else
  window.g.loadQueue.push({
    fun: startManager,
    data: "",
  });
