const MAP_GEOJSON_URLS = [
  "./data/cabins.geojson",
  "./data/zones.geojson",
  "./data/poi.geojson",
  "./data/paths.geojson"
];

const CATALOG_URL = "./data/catalog.json";

let map;
let catalogById = {};
let geoLayer;
let userMarker;

const elSheet = document.getElementById("sheet");
const elSheetClose = document.getElementById("sheetClose");
const elSheetTitle = document.getElementById("sheetTitle");
const elSheetSubtitle = document.getElementById("sheetSubtitle");
const elSheetDesc = document.getElementById("sheetDesc");
const elSheetMedia = document.getElementById("sheetMedia");
const elSheetBadge = document.getElementById("sheetBadge");
const elSheetMeta = document.getElementById("sheetMeta");
const elSheetTags = document.getElementById("sheetTags");
const elSheetActions = document.getElementById("sheetActions");
const elToast = document.getElementById("toast");
const btnLocate = document.getElementById("btnLocate");

function toast(msg){
  elToast.textContent = msg;
  elToast.classList.add("toast--show");
  setTimeout(()=> elToast.classList.remove("toast--show"), 2200);
}

function typeLabel(t){
  const map = {
    cabin: "Домик",
    poi: "Точка",
    zone: "Зона",
    path: "Тропинка",
  };
  return map[t] || "Объект";
}

function styleForFeature(feature) {
  const type = feature.properties?.type;

  if (type === "zone") {
    return {
      color: "#4CAF50",     // мягкий зелёный контур
      weight: 1,
      fillColor: "#4CAF50",
      fillOpacity: 0.08     // очень лёгкая заливка
    };
  }

  if (type === "cabin") {
    return {
      color: "#ffffff",     // белый контур
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.05
    };
  }

  if (type === "path") {
    return {
      color: "#ffffff",
      weight: 2,
      opacity: 0.6
    };
  }

  // poi (точки)
  return {};
}

function styleForFeature(feature) {
  return {
    color: "#ffffff",
    weight: 2,
    fillOpacity: 0
  };
}


function pointToLayer(feature, latlng){
  const t = feature?.properties?.type;
  // простые circle marker — MVP
  const radius = (t === "poi") ? 8 : 7;

  return L.circleMarker(latlng, {
    radius,
    weight: 2,
    opacity: 0.95,
    fillOpacity: 0.28
  });
}

function openSheetByFeature(feature){
  const props = feature.properties || {};
  const id = props.id;
  const t = props.type;
  const label = props.label || id || "Объект";
  const data = catalogById[id] || {};

  elSheetBadge.textContent = typeLabel(t);

  elSheetTitle.textContent = data.title || label;
  elSheetSubtitle.textContent = data.subtitle || "";

  // meta chips (вместимость/цена)
  elSheetMeta.innerHTML = "";
  const chips = [];
  if (data.capacity) chips.push(`👥 ${data.capacity}`);
  if (data.price) chips.push(`💳 ${data.price}`);
  if (data.distance) chips.push(`📍 ${data.distance}`);
  chips.forEach(txt=>{
    const d = document.createElement("div");
    d.className = "chip";
    d.textContent = txt;
    elSheetMeta.appendChild(d);
  });

  elSheetDesc.textContent = data.desc || "";

  // tags
  elSheetTags.innerHTML = "";
  (data.tags || []).forEach(tag=>{
    const tEl = document.createElement("div");
    tEl.className = "tag";
    tEl.textContent = tag;
    elSheetTags.appendChild(tEl);
  });

  // media
  elSheetMedia.innerHTML = "";
  if (data.photo){
    const img = document.createElement("img");
    img.alt = data.title || label;
    img.src = data.photo;
    img.onerror = () => {
      elSheetMedia.textContent = "Фото не найдено";
    };
    elSheetMedia.appendChild(img);
  } else {
    elSheetMedia.textContent = "Фото (MVP: можно добавить позже)";
  }

  // actions
  elSheetActions.innerHTML = "";
  const links = data.links || {};
  const actions = [];

  if (links.detailsUrl){
    actions.push({ title:"Подробнее", url: links.detailsUrl, primary:false });
  }
  if (links.bookingUrl){
    actions.push({ title:"Забронировать", url: links.bookingUrl, primary:true });
  }
  if (links.phone){
    actions.push({ title:"Позвонить", url: `tel:${links.phone}`, primary:false });
  }

  if (actions.length === 0){
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = "Ок";
    b.onclick = closeSheet;
    elSheetActions.appendChild(b);
  } else {
    actions.forEach(a=>{
      const b = document.createElement("button");
      b.className = a.primary ? "btn btn--primary" : "btn";
      b.textContent = a.title;
      b.onclick = ()=> window.open(a.url, "_blank");
      elSheetActions.appendChild(b);
    });
  }

  elSheet.classList.add("sheet--open");
  elSheet.setAttribute("aria-hidden", "false");
}

function closeSheet(){
  elSheet.classList.remove("sheet--open");
  elSheet.setAttribute("aria-hidden", "true");
}

function bindFeatureEvents(feature, layer){
  layer.on("click", ()=>{
    openSheetByFeature(feature);
  });

  // hover не нужен на мобилках, но подсказка на десктопе не мешает
  const label = feature?.properties?.label;
  if (label) layer.bindTooltip(label, { direction: "top", opacity: 0.9 });
}



async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Не удалось загрузить ${url} (${res.status})`);
  return await res.json();
}

function normalizeGeoJSONToImage(geojson, imageWidth, imageHeight) {
  const cloned = JSON.parse(JSON.stringify(geojson));

  // 1) собираем все координаты в один список и считаем bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function visitCoords(coords) {
    if (!coords) return;

    // Point: [x,y]
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0], y = coords[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }

    // Nested arrays
    coords.forEach(visitCoords);
  }

  cloned.features.forEach(f => visitCoords(f.geometry.coordinates));

  const dx = maxX - minX;
  const dy = maxY - minY;

  // защита от пустых/битых данных
  if (!isFinite(dx) || !isFinite(dy) || dx === 0 || dy === 0) {
    return cloned;
  }

  // 2) преобразуем координаты в пиксельную систему:
  // x -> [0..W]
  // y -> [0..H] и одновременно FLIP (потому что в Leaflet Y вниз)
  function transformCoords(coords) {
    if (!coords) return coords;

    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0], y = coords[1];

      const nx = (x - minX) / dx;         // 0..1
      const ny = (y - minY) / dy;         // 0..1

      const px = nx * imageWidth;
      const py = (1 - ny) * imageHeight;  // flip Y

      return [px, py];
    }

    return coords.map(transformCoords);
  }

  cloned.features.forEach(f => {
    f.geometry.coordinates = transformCoords(f.geometry.coordinates);
  });

  return cloned;
}

function getGeoJSONBounds(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function visit(coords) {
    if (!coords) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0], y = coords[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(visit);
  }

  geojson.features.forEach(f => visit(f.geometry.coordinates));
  return { minX, minY, maxX, maxY };
}

function transformGeoJSONToImage(geojson, bbox, W, H, offX = 0, offY = 0) {
  const cloned = JSON.parse(JSON.stringify(geojson));

  const dx = bbox.maxX - bbox.minX;
  const dy = bbox.maxY - bbox.minY;

  // защита
  if (!isFinite(dx) || !isFinite(dy) || dx === 0 || dy === 0) return cloned;

  function transform(coords) {
    if (!coords) return coords;

    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0], y = coords[1];

      // X: слева направо
      const nx = (x - bbox.minX) / dx;     // 0..1
      // Y: делаем "вниз" (Leaflet), поэтому берём от maxY
      const ny = (y - bbox.minY) / dy;  // 0..1

      return [offX + nx * W, offY + ny * H];

    }

    return coords.map(transform);
  }

  cloned.features.forEach(f => {
    f.geometry.coordinates = transform(f.geometry.coordinates);
  });

  return cloned;
}


async function init(){

  
  // 1) плоская карта (не география)
  map = L.map("map", {
    crs: L.CRS.Simple,
    zoomControl: true,
    minZoom: -2,
    maxZoom: 2
  });

  // 2) реальные размеры картинки
  const IMAGE_WIDTH = 1482;
  const IMAGE_HEIGHT = 844;

  const imageBounds = [[0, 0], [IMAGE_HEIGHT, IMAGE_WIDTH]];
  L.imageOverlay("./assets/base.png", imageBounds).addTo(map);
  map.fitBounds(imageBounds);

  const SCHEME_WIDTH = 1126;
  const SCHEME_HEIGHT = 844;
  const SCHEME_OFFSET_X = (IMAGE_WIDTH - SCHEME_WIDTH) / 2- 32;; // 178
  const SCHEME_OFFSET_Y = 0; // сверху нет поля

  const catalog = await loadJSON(CATALOG_URL);
  catalogById = catalog || {};

  // загружаем все geojson-слои
  const geojsons = await Promise.all(
    MAP_GEOJSON_URLS.map(url => loadJSON(url))
  );

  // 1) общий bbox по всем слоям
  let global = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  geojsons.forEach(g => {
    const b = getGeoJSONBounds(g);
    if (b.minX < global.minX) global.minX = b.minX;
    if (b.minY < global.minY) global.minY = b.minY;
    if (b.maxX > global.maxX) global.maxX = b.maxX;
    if (b.maxY > global.maxY) global.maxY = b.maxY;
  });

  const layers = [];

  // 2) одинаково трансформируем каждый слой + правильный порядок отрисовки
  const byName = {};
  geojsons.forEach(g => { byName[g.name] = g; }); // name в твоих geojson: cabins/zones/poi/paths

  const ordered = [
    byName["zones"],
    byName["paths"],
    byName["cabins"],
    byName["poi"]
  ].filter(Boolean);

  ordered.forEach(geojson => {
    const fixed = transformGeoJSONToImage(
      geojson,
      global,
      SCHEME_WIDTH,
      SCHEME_HEIGHT,
      SCHEME_OFFSET_X,
      SCHEME_OFFSET_Y
    );

  const layer = L.geoJSON(fixed, {
    style: styleForFeature,
    pointToLayer,
    onEachFeature: bindFeatureEvents
  }).addTo(map);

  layers.push(layer);
});




//  const group = L.featureGroup(layers);
//  const dataBounds = group.getBounds();

//  if (dataBounds && dataBounds.isValid && dataBounds.isValid()) {
//    map.fitBounds(dataBounds, { padding: [24, 24] });
//  } else {
    // если данных нет/не загрузились — остаёмся на картинке
//    map.fitBounds(imageBounds);
//  }




  // UI
  elSheetClose.addEventListener("click", closeSheet);

  // закрытие по клику вне? (простая версия)
  map.on("click", ()=> {
    // не закрываем всегда, чтобы не бесило:
    // closeSheet();
  });

 //  btnLocate.addEventListener("click", locateUser);

  toast("Готово: кликни по домику или зоне");
}

function locateUser(){
  
  if (!navigator.geolocation){
    toast("Геолокация недоступна");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const { latitude, longitude } = pos.coords;
      const latlng = [latitude, longitude];

      if (!userMarker){
        userMarker = L.circleMarker(latlng, { radius: 8, weight: 2, opacity: 1, fillOpacity: 0.3 });
        userMarker.addTo(map).bindTooltip("Вы здесь");
      } else {
        userMarker.setLatLng(latlng);
      }

      map.setView(latlng, Math.max(map.getZoom(), 17));
      toast("Показал ваше местоположение");
    },
    ()=>{
      toast("Не получилось получить геолокацию");
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

init().catch(err=>{
  console.error(err);
  toast("Ошибка загрузки данных. Открой консоль.");
});
