
# 📅 Intégration du Calendrier de Planification Admin

## 🎯 Objectif

Implémenter un calendrier interactif dans le dashboard admin permettant :
- l’ajout d’événements (réunions, congés, formations, autres),
- l’affichage visuel dans un calendrier mensuel,
- la modification des dates par glisser-déposer.

---

## 🧱 Structure de la base de données

Créer une table `evenements` :

```sql
CREATE TABLE evenements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titre VARCHAR(255),
  description TEXT,
  date DATE,
  type ENUM('réunion', 'congé', 'formation', 'autre') DEFAULT 'autre',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 💡 Technologie utilisée

- [FullCalendar.js](https://fullcalendar.io/) (via CDN)
- JavaScript + PHP
- JSON pour communication front/back

---

## 📁 Fichiers nécessaires

### 1. Frontend (HTML + JS)
- Cible : div `#calendar-admin`
- Actions :
  - Clic sur une date → prompt → POST via `fetch` vers `add_event.php`
  - Clic sur un événement → alert (infos)
  - Drag & drop → POST via `fetch` vers `update_event.php`
- Chargement dynamique des événements via :
  ```js
  events: 'load_events.php'
  ```

### 2. Backend (PHP)
- `load_events.php` → retourne les événements en JSON
- `add_event.php` → enregistre un événement en base
- `update_event.php` → met à jour la date d’un événement

---

## ✅ Fonctionnalités actives

- Affichage dynamique des événements
- Ajout rapide via clic date
- Déplacement par glisser-déposer
- Aucune recharge de page nécessaire

---

## 🎨 Style

- Personnalisation via CSS (couleurs selon le type d’événement)
- Intégration fluide dans le design du dashboard admin

---

## 🔧 À prévoir plus tard (facultatif)

- Suppression et édition visuelle des événements
- Filtres par type ou date
- Notifications ou rappels automatisés
