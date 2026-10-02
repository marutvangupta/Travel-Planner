"""Bundled demo dataset: lets the whole app (and the evals) run offline with no API keys.

Coordinates are approximate and costs are rough per-person INR estimates written for this demo.
Guide notes are original summaries, not copied from any third-party source.
"""

from __future__ import annotations

from ..schemas import Hours

DESTINATIONS: dict[str, dict] = {
    "jaipur": {
        "name": "Jaipur, India", "country": "India", "currency": "INR", "lat": 26.9124, "lng": 75.7873,
        "aliases": ["jaipur", "pink city"],
        "transport": {"kind": "taxi", "base": 40, "per_km": 16},
    },
    "goa": {
        "name": "Goa, India", "country": "India", "currency": "INR", "lat": 15.4989, "lng": 73.8278,
        "aliases": ["goa", "panaji", "panjim"],
        "transport": {"kind": "taxi", "base": 80, "per_km": 24},
    },
    "tokyo": {
        "name": "Tokyo, Japan", "country": "Japan", "currency": "JPY", "lat": 35.6762, "lng": 139.6503,
        "aliases": ["tokyo", "tōkyō"],
        "transport": {"kind": "transit", "flat": 170},
    },
    "paris": {
        "name": "Paris, France", "country": "France", "currency": "EUR", "lat": 48.8566, "lng": 2.3522,
        "aliases": ["paris"],
        "transport": {"kind": "transit", "flat": 190},
    },
}


def parse_hours(spec: str | None) -> Hours | None:
    """'09:00-17:00' | '08:00-11:00,12:00-17:00' | 'always' | '...|closed=1,2' | '...|only=2'. 0 = Monday."""
    if spec is None:
        return None
    windows_part, _, rule = spec.partition("|")
    if windows_part == "always":
        windows = [(0, 24 * 60)]
    else:
        windows = []
        for chunk in windows_part.split(","):
            a, b = chunk.split("-")
            ah, am = a.split(":")
            bh, bm = b.split(":")
            windows.append((int(ah) * 60 + int(am), int(bh) * 60 + int(bm)))
    closed: set[int] = set()
    only: set[int] | None = None
    if rule.startswith("closed="):
        closed = {int(x) for x in rule[7:].split(",")}
    elif rule.startswith("only="):
        only = {int(x) for x in rule[5:].split(",")}
    out: Hours = {}
    for d in range(7):
        if d in closed or (only is not None and d not in only):
            out[d] = []
        else:
            out[d] = list(windows)
    return out


# slug, name, category, tags, lat, lng, rating, price_level, cost_inr, duration_min, indoor,
# hours, step_free, diet_tags, area, description
_P = tuple
PLACES: dict[str, list[_P]] = {
    "jaipur": [
        ("amber-fort", "Amber Fort", "fort", ["history", "architecture", "culture"], 26.9855, 75.8513, 4.6, 2, 600, 150, False, "08:00-17:30", False, [], "Amer", "Hilltop Rajput fort with mirrored halls, ramparts and long views over Maota Lake."),
        ("city-palace", "City Palace", "palace", ["history", "culture", "architecture"], 26.9258, 75.8237, 4.5, 3, 700, 120, True, "09:30-17:00", True, [], "Old City", "Royal residence still partly lived in, with textile, arms and courtyard galleries."),
        ("hawa-mahal", "Hawa Mahal", "monument", ["architecture", "culture"], 26.9239, 75.8267, 4.4, 1, 250, 45, False, "09:00-16:30", False, [], "Old City", "The honeycombed pink sandstone facade; best light is early morning."),
        ("jantar-mantar", "Jantar Mantar", "observatory", ["history", "culture"], 26.9247, 75.8246, 4.5, 1, 250, 60, False, "09:00-16:30", True, [], "Old City", "Open-air astronomical instruments built in the 1730s, including the world's largest stone sundial."),
        ("nahargarh-fort", "Nahargarh Fort", "fort", ["adventure", "history", "nature"], 26.9373, 75.8153, 4.5, 2, 400, 100, False, "10:00-22:00", False, [], "Aravalli ridge", "Ridge-top fort above the city, popular for sunset views and a rooftop cafe."),
        ("jal-mahal", "Jal Mahal Viewpoint", "viewpoint", ["relaxation", "architecture"], 26.9534, 75.8462, 4.3, 0, 0, 30, False, "always", True, [], "Man Sagar", "The water palace seen from the lakeside promenade; quick stop on the way to Amber."),
        ("johari-bazaar", "Johari Bazaar", "market", ["shopping", "culture"], 26.9196, 75.8264, 4.3, 2, 1500, 90, False, "10:30-20:30|closed=6", True, [], "Old City", "Jewellery, lac bangles and block-printed textiles in a dense, lively bazaar."),
        ("albert-hall", "Albert Hall Museum", "museum", ["art", "history", "culture"], 26.9118, 75.8195, 4.4, 1, 300, 90, True, "09:00-17:00", True, [], "Ram Niwas Garden", "Indo-Saracenic museum with miniature paintings, carpets and an Egyptian mummy."),
        ("chokhi-dhani", "Chokhi Dhani Village Dinner", "show", ["culture", "food", "nightlife"], 26.7658, 75.8438, 4.2, 3, 1400, 150, False, "18:00-23:00", True, ["vegetarian"], "Tonk Road", "Staged Rajasthani village with folk dance, puppetry and a thali dinner."),
        ("lmb", "Laxmi Misthan Bhandar (LMB)", "restaurant", ["food"], 26.9186, 75.8246, 4.2, 2, 550, 60, True, "08:00-22:30", True, ["vegetarian"], "Johari Bazaar", "Old sweet shop and restaurant; try the ghewar and a vegetarian Rajasthani thali."),
        ("rawat-kachori", "Rawat Mishthan Bhandar", "cafe", ["food"], 26.9158, 75.7885, 4.3, 1, 250, 45, True, "07:30-21:00", True, ["vegetarian"], "Station Road", "Famous pyaaz kachori and mawa kachori counter; quick and cheap."),
        ("masala-chowk", "Masala Chowk Food Court", "market", ["food"], 26.9140, 75.8190, 4.1, 1, 400, 60, False, "11:00-23:00", True, ["vegetarian"], "Ram Niwas Garden", "Open-air court of street-food stalls from across Rajasthan."),
        ("bar-palladio", "Bar Palladio", "bar", ["nightlife", "relaxation"], 26.9025, 75.8010, 4.5, 4, 2600, 90, True, "11:00-23:30", True, ["vegetarian"], "Narain Niwas", "Blue-walled Italian-style bar in a heritage hotel garden; reserve ahead."),
        ("panna-meena", "Panna Meena ka Kund", "stepwell", ["architecture", "culture"], 26.9873, 75.8566, 4.4, 0, 0, 30, False, "07:00-18:00", False, [], "Amer", "Geometric stepwell close to Amber; a calm, photogenic quick stop."),
        ("anokhi-museum", "Anokhi Museum of Hand Printing", "museum", ["art", "culture", "shopping"], 26.9868, 75.8559, 4.5, 1, 250, 60, True, "10:30-17:00|closed=0", True, [], "Amer", "Small museum in a restored haveli covering block-printing techniques, with hands-on demos."),
        ("handi", "Handi Restaurant", "restaurant", ["food"], 26.9170, 75.8020, 4.2, 2, 900, 60, True, "11:00-23:30", True, [], "MI Road", "Classic non-vegetarian Mughlai and Rajasthani curries served in clay handis."),
        ("tapri-central", "Tapri Central", "cafe", ["food", "relaxation"], 26.9180, 75.8000, 4.3, 1, 600, 45, True, "09:00-23:00", True, ["vegetarian"], "C-Scheme", "Casual rooftop cafe with chai, snacks and light vegetarian meals."),
        ("peacock-rooftop", "Peacock Rooftop Restaurant", "restaurant", ["food", "architecture"], 26.9242, 75.8270, 4.2, 2, 900, 60, False, "10:00-22:30", True, ["vegetarian"], "Hawa Mahal", "Rooftop dining facing Hawa Mahal; good for a sunset dinner."),
        ("jawahar-kala-kendra", "Jawahar Kala Kendra", "gallery", ["art", "culture", "architecture"], 26.8995, 75.8070, 4.3, 1, 150, 75, True, "10:00-17:30", True, [], "Jawahar Circle", "Arts centre designed around Jaipur's nine-square city plan, with changing exhibitions."),
        ("sanganer-printing", "Sanganer Block-Printing Workshop", "workshop", ["art", "culture", "shopping"], 26.8221, 75.7900, 4.4, 2, 900, 120, True, "10:00-17:00", True, [], "Sanganer", "Hands-on hand-block printing session in a family workshop; you take your print home."),
        ("rajasthani-cooking", "Rajasthani Cooking Class", "workshop", ["food", "culture"], 26.9170, 75.8110, 4.7, 2, 1800, 150, True, "10:00-14:00,17:00-21:30", True, ["vegetarian"], "C-Scheme", "Small-group class cooking dal baati and kadhi, finishing with a shared meal."),
        ("wax-museum", "Sheesh Mahal Wax Museum", "museum", ["culture", "history"], 26.9873, 75.8500, 4.0, 2, 500, 60, True, "10:00-19:00", True, [], "Amer", "Wax figures of Rajasthani rulers and artists, set in mirrored halls near Nahargarh."),
        ("suvarna-mahal", "Suvarna Mahal, Rambagh Palace", "restaurant", ["food", "relaxation"], 26.8963, 75.8032, 4.7, 4, 6500, 120, True, "19:00-23:00", True, ["vegetarian"], "Bhawani Singh Rd", "Formal palace dining room with royal Indian menu; a splurge dinner."),
    ],
    "goa": [
        ("bom-jesus", "Basilica of Bom Jesus", "church", ["history", "culture", "architecture"], 15.5009, 73.9116, 4.5, 0, 0, 45, True, "09:00-18:30", True, [], "Old Goa", "16th-century baroque basilica holding the relics of St Francis Xavier."),
        ("fort-aguada", "Fort Aguada", "fort", ["history", "adventure"], 15.4929, 73.7731, 4.4, 1, 100, 75, False, "08:30-18:00", False, [], "Candolim", "17th-century Portuguese fort with a lighthouse and sea views."),
        ("baga-beach", "Baga Beach", "beach", ["relaxation", "adventure", "nightlife"], 15.5553, 73.7517, 4.2, 0, 300, 150, False, "always", True, [], "Baga", "Busy north Goa beach with water sports, shacks and loud evenings."),
        ("anjuna-market", "Anjuna Wednesday Flea Market", "market", ["shopping", "culture"], 15.5736, 73.7413, 4.1, 1, 1200, 120, False, "08:30-18:00|only=2", True, [], "Anjuna", "Open-air flea market that runs only on Wednesdays."),
        ("palolem", "Palolem Beach", "beach", ["nature", "relaxation"], 15.0100, 74.0232, 4.6, 0, 400, 180, False, "always", True, [], "Canacona", "Crescent beach in the far south; calm water and kayaking, a long drive from the north."),
        ("dudhsagar", "Dudhsagar Falls Jeep Safari", "waterfall", ["nature", "adventure"], 15.3144, 74.3143, 4.5, 2, 1800, 240, False, "08:00-17:00", False, [], "Mollem", "Four-tier waterfall reached by jeep through forest; a half-day commitment."),
        ("fontainhas", "Fontainhas Latin Quarter", "neighbourhood", ["culture", "architecture", "art"], 15.4965, 73.8330, 4.5, 0, 200, 90, False, "always", True, [], "Panaji", "Portuguese-era lanes of painted houses, galleries and bakeries."),
        ("chapora-fort", "Chapora Fort", "fort", ["history", "adventure"], 15.6045, 73.7352, 4.3, 0, 0, 60, False, "09:00-17:30", False, [], "Vagator", "Ruined hill fort above Vagator beach; short steep climb."),
        ("thalassa", "Thalassa Greek Taverna", "restaurant", ["food", "relaxation"], 15.6054, 73.7378, 4.3, 3, 2600, 90, False, "12:00-23:30", True, ["vegetarian"], "Vagator", "Cliffside Greek restaurant with sunset seating and a vegetarian mezze menu."),
        ("brittos", "Britto's", "restaurant", ["food"], 15.5545, 73.7552, 4.1, 2, 1600, 75, False, "11:00-23:00", True, [], "Baga", "Beachfront seafood institution; heavy on fish and prawns."),
        ("ritz-classic", "Ritz Classic Goan Thali", "restaurant", ["food", "culture"], 15.4989, 73.8278, 4.3, 2, 700, 60, True, "11:30-15:30,19:00-22:30", True, ["vegetarian"], "Panaji", "Long-running Goan thali house with a vegetarian thali option."),
        ("mandovi-cruise", "Mandovi River Sunset Cruise", "cruise", ["relaxation", "culture"], 15.4986, 73.8232, 4.2, 2, 700, 60, False, "17:30-19:30", True, [], "Panaji", "One-hour evening river cruise with live Goan folk music."),
        ("titos-lane", "Tito's Lane", "nightlife", ["nightlife"], 15.5562, 73.7529, 4.0, 3, 2200, 150, False, "20:00-23:59", False, ["vegetarian"], "Baga", "Goa's best-known club strip; loud and late."),
        ("infantaria", "Infantaria Cafe", "cafe", ["food"], 15.5440, 73.7650, 4.2, 2, 800, 60, True, "08:00-23:00", True, ["vegetarian"], "Calangute", "Bakery-cafe with all-day breakfast, pastries and vegetarian plates."),
        ("gunpowder", "Gunpowder", "restaurant", ["food", "culture"], 15.5990, 73.7640, 4.5, 2, 1400, 75, False, "12:00-23:00", True, ["vegetarian"], "Assagao", "South Indian coastal cooking in a garden courtyard, with plenty of vegetarian dishes."),
        ("vinayak", "Vinayak Family Restaurant", "restaurant", ["food"], 15.5990, 73.7660, 4.3, 2, 1200, 75, True, "12:00-23:00", True, [], "Assagao", "Busy local place for Goan fish thali and prawn curry."),
        ("museum-of-goa", "Museum of Goa", "museum", ["art", "culture"], 15.5590, 73.8120, 4.4, 2, 400, 90, True, "10:00-18:00|closed=0", True, [], "Pilerne", "Contemporary art museum with Goan craft and sculpture."),
        ("goa-chitra", "Goa Chitra Museum", "museum", ["culture", "history"], 15.2330, 73.9910, 4.5, 2, 600, 90, True, "10:00-17:30", True, [], "Benaulim", "Private ethnographic museum of traditional farming and village life tools."),
        ("goan-cooking", "Goan Cooking Class", "workshop", ["food", "culture"], 15.4920, 73.8200, 4.6, 2, 2200, 150, True, "10:00-14:00", True, ["vegetarian"], "Panaji", "Home-kitchen class on xacuti, fish curry and a vegetarian alternative menu."),
        ("ayurveda-spa", "Ayurvedic Spa Session", "spa", ["relaxation"], 15.5550, 73.7620, 4.4, 3, 3200, 90, True, "09:00-20:00", True, [], "Calangute", "Traditional oil massage and steam treatment; book ahead."),
        ("spice-plantation", "Sahakari Spice Farm", "farm", ["nature", "food", "culture"], 15.4040, 74.0210, 4.2, 2, 900, 150, False, "09:00-16:30", True, ["vegetarian"], "Ponda", "Guided spice-farm walk finishing with a buffet lunch."),
    ],
    "tokyo": [
        ("sensoji", "Senso-ji Temple", "temple", ["culture", "history"], 35.7148, 139.7967, 4.6, 0, 0, 75, False, "06:00-17:00", True, [], "Asakusa", "Tokyo's oldest temple, approached through the Nakamise shopping street."),
        ("meiji-jingu", "Meiji Jingu", "shrine", ["culture", "nature", "relaxation"], 35.6764, 139.6993, 4.6, 0, 0, 90, False, "06:00-18:00", True, [], "Harajuku", "Forested shrine in the middle of the city; quiet gravel paths."),
        ("teamlab-planets", "teamLab Planets", "museum", ["art", "adventure"], 35.6491, 139.7897, 4.6, 3, 2600, 120, True, "09:00-22:00", False, [], "Toyosu", "Immersive digital art you walk through barefoot; book timed tickets."),
        ("tsukiji-market", "Tsukiji Outer Market", "market", ["food", "culture"], 35.6655, 139.7707, 4.4, 2, 2200, 90, False, "05:00-14:00|closed=6", True, [], "Tsukiji", "Street-food lanes for tamagoyaki, seafood skewers and knives; go before noon."),
        ("shibuya-sky", "Shibuya Sky", "viewpoint", ["architecture", "adventure"], 35.6585, 139.7022, 4.6, 3, 2100, 60, False, "10:00-22:30", True, [], "Shibuya", "Rooftop observation deck above Shibuya Crossing."),
        ("skytree", "Tokyo Skytree", "viewpoint", ["architecture"], 35.7101, 139.8107, 4.4, 3, 2300, 90, True, "10:00-21:00", True, [], "Sumida", "Tallest tower in Japan with two observation decks."),
        ("akihabara", "Akihabara Electric Town", "district", ["shopping", "culture", "adventure"], 35.6984, 139.7731, 4.4, 2, 1800, 120, True, "10:00-21:00", True, [], "Chiyoda", "Multi-floor arcades, anime shops and retro game stores."),
        ("tokyo-national-museum", "Tokyo National Museum", "museum", ["art", "history", "culture"], 35.7189, 139.7765, 4.5, 2, 950, 150, True, "09:30-17:00|closed=0", True, [], "Ueno", "Japan's largest collection of art and archaeology, including samurai armour."),
        ("ichiran", "Ichiran Ramen Shibuya", "restaurant", ["food"], 35.6619, 139.6993, 4.3, 1, 1300, 45, True, "10:00-23:00", True, [], "Shibuya", "Solo-booth tonkotsu ramen; pork broth, not suitable for vegetarians."),
        ("ts-tantan", "T's TanTan Vegan Ramen", "restaurant", ["food"], 35.6812, 139.7671, 4.4, 2, 1300, 45, True, "08:00-22:00", True, ["vegetarian", "vegan"], "Tokyo Station", "Vegan ramen inside Tokyo Station's Keiyo Street."),
        ("golden-gai", "Golden Gai", "nightlife", ["nightlife", "culture"], 35.6940, 139.7035, 4.2, 3, 2800, 120, True, "20:00-23:59", False, [], "Shinjuku", "Six alleys of tiny themed bars seating 6-10 people each."),
        ("shinjuku-gyoen", "Shinjuku Gyoen", "park", ["nature", "relaxation"], 35.6852, 139.7100, 4.6, 1, 300, 90, False, "09:00-16:30|closed=0", True, [], "Shinjuku", "Large garden mixing Japanese, French and English landscapes."),
        ("sasa-no-yuki", "Sasa no Yuki Tofu Cuisine", "restaurant", ["food", "culture"], 35.7227, 139.7777, 4.4, 3, 3200, 75, True, "11:30-20:00|closed=0", True, ["vegetarian", "vegan"], "Uguisudani", "Edo-era tofu restaurant serving shojin-style vegetarian courses."),
        ("sushi-zanmai", "Sushi Zanmai Tsukiji", "restaurant", ["food"], 35.6672, 139.7705, 4.2, 2, 2400, 60, True, "00:00-23:59", True, [], "Tsukiji", "24-hour counter sushi near the market; seafood."),
        ("afuri", "Afuri Ramen Harajuku", "restaurant", ["food"], 35.6700, 139.7030, 4.3, 2, 1500, 45, True, "11:00-23:00", True, [], "Harajuku", "Light yuzu-shio ramen; broth contains chicken and fish stock."),
        ("nezu-museum", "Nezu Museum", "museum", ["art", "culture", "relaxation"], 35.6620, 139.7183, 4.5, 2, 1200, 90, True, "10:00-17:00|closed=0", True, [], "Aoyama", "Japanese and East Asian art with a quiet garden and teahouses."),
        ("sumida-aquarium", "Sumida Aquarium", "aquarium", ["nature", "adventure"], 35.7101, 139.8133, 4.2, 2, 1700, 90, True, "10:00-20:00", True, [], "Skytree Town", "Compact aquarium famous for its open-pool penguin and jellyfish displays."),
        ("sushi-class", "Sushi-Making Class", "workshop", ["food", "culture"], 35.6735, 139.7690, 4.7, 3, 6000, 120, True, "10:00-14:00", True, [], "Ginza", "Hands-on class with a chef; the menu is seafood-based."),
        ("ueno-sushi", "Uobei Sushi Train Shibuya", "restaurant", ["food"], 35.6593, 139.6982, 4.1, 1, 1500, 50, True, "11:00-22:00", True, [], "Shibuya", "Fast conveyor-belt sushi ordered on a touchscreen; seafood-based."),
    ],
    "paris": [
        ("eiffel-tower", "Eiffel Tower", "monument", ["architecture", "culture"], 48.8584, 2.2945, 4.6, 3, 2900, 120, False, "09:00-23:00", True, [], "7th arr.", "Iron lattice tower with summit access; book timed tickets in advance."),
        ("louvre", "Louvre Museum", "museum", ["art", "history", "culture"], 48.8606, 2.3376, 4.7, 3, 2100, 180, True, "09:00-18:00|closed=1", True, [], "1st arr.", "The world's largest art museum; pick a wing instead of trying to see it all."),
        ("musee-dorsay", "Musée d'Orsay", "museum", ["art", "culture"], 48.8600, 2.3266, 4.7, 3, 1700, 120, True, "09:30-18:00|closed=0", True, [], "7th arr.", "Impressionist and post-impressionist collection in a former railway station."),
        ("notre-dame", "Île de la Cité & Notre-Dame", "monument", ["history", "architecture"], 48.8530, 2.3499, 4.7, 0, 0, 60, False, "07:45-18:45", True, [], "4th arr.", "Cathedral exterior and island walk; the restored interior needs a free timed slot."),
        ("montmartre", "Montmartre & Sacré-Cœur", "district", ["art", "culture", "relaxation"], 48.8867, 2.3431, 4.6, 0, 300, 120, False, "06:00-22:30", False, [], "18th arr.", "Hilltop village of artists' squares, steps and a white basilica with city views."),
        ("seine-cruise", "Seine River Cruise", "cruise", ["relaxation", "architecture"], 48.8639, 2.3043, 4.4, 2, 1500, 70, False, "10:00-22:30", True, [], "Pont de l'Alma", "One-hour boat ride past the main monuments; lovely at dusk."),
        ("luxembourg", "Luxembourg Gardens", "park", ["nature", "relaxation"], 48.8462, 2.3371, 4.7, 0, 0, 75, False, "07:30-21:00", True, [], "6th arr.", "Formal gardens with chairs to sit in and a model-boat pond."),
        ("le-marais", "Le Marais Walk", "district", ["shopping", "culture", "history"], 48.8571, 2.3622, 4.5, 1, 1200, 120, False, "10:00-19:00", True, [], "3rd/4th arr.", "Medieval lanes, Place des Vosges, boutiques and the Jewish quarter."),
        ("cafe-de-flore", "Café de Flore", "cafe", ["food", "culture"], 48.8541, 2.3326, 4.1, 3, 2000, 60, True, "07:30-23:30", True, ["vegetarian"], "Saint-Germain", "Historic literary cafe; pricey but a classic Parisian pause."),
        ("l-as-du-fallafel", "L'As du Fallafel", "restaurant", ["food"], 48.8578, 2.3589, 4.4, 1, 1200, 45, True, "11:00-23:00|closed=5", True, ["vegetarian", "vegan"], "Le Marais", "Falafel sandwich counter with a constant queue; vegetarian."),
        ("bouillon-chartier", "Le Bouillon Chartier", "restaurant", ["food", "history"], 48.8721, 2.3433, 4.2, 2, 2000, 75, True, "11:30-22:00", True, [], "9th arr.", "Grand 1896 dining hall serving cheap classic French dishes; meat-forward menu."),
        ("moulin-rouge", "Moulin Rouge Revue", "show", ["nightlife", "culture"], 48.8841, 2.3322, 4.3, 4, 12500, 120, True, "19:00-23:30", False, [], "Pigalle", "The famous cabaret revue; book dinner-and-show or show-only seats ahead."),
        ("breizh-cafe", "Breizh Café", "restaurant", ["food"], 48.8636, 2.3620, 4.4, 2, 1700, 75, True, "11:30-23:00", True, ["vegetarian"], "Le Marais", "Buckwheat galettes and crêpes with good vegetarian fillings."),
        ("potager-marais", "Le Potager du Marais", "restaurant", ["food"], 48.8625, 2.3590, 4.4, 2, 2100, 75, True, "12:00-22:30", True, ["vegetarian", "vegan"], "Le Marais", "Vegetarian French bistro with vegan options."),
        ("enfants-rouges", "Marché des Enfants Rouges", "market", ["food", "culture"], 48.8629, 2.3626, 4.4, 1, 1400, 60, True, "08:30-20:00|closed=0", True, ["vegetarian"], "Le Marais", "Paris's oldest covered market with stalls for Moroccan, Japanese and French lunches."),
        ("sainte-chapelle", "Sainte-Chapelle", "church", ["history", "architecture", "art"], 48.8554, 2.3450, 4.7, 2, 1300, 45, True, "09:00-17:00", True, [], "Île de la Cité", "Gothic royal chapel whose walls are almost entirely stained glass."),
        ("orangerie", "Musée de l'Orangerie", "museum", ["art"], 48.8638, 2.3226, 4.6, 2, 1200, 75, True, "09:00-18:00|closed=1", True, [], "Tuileries", "Monet's Water Lilies in two oval rooms; small and calming."),
        ("french-cooking", "Paris Cooking Class", "workshop", ["food", "culture"], 48.8535, 2.3470, 4.7, 3, 7500, 150, True, "10:00-13:30,16:30-21:30", True, ["vegetarian"], "Latin Quarter", "Morning class making pastry or a bistro menu; vegetarian option on request."),
        ("galeries-lafayette", "Galeries Lafayette Haussmann", "market", ["shopping", "architecture"], 48.8738, 2.3320, 4.4, 2, 3000, 90, True, "10:00-20:30|closed=6", True, [], "9th arr.", "Department store under a stained-glass dome with a free rooftop terrace."),
        ("versailles", "Palace of Versailles", "palace", ["history", "architecture"], 48.8049, 2.1204, 4.6, 3, 2300, 240, True, "09:00-17:30|closed=0", True, [], "Versailles", "Royal palace and gardens, a half-day trip outside the city."),
    ],
}

# Short original notes used as the RAG corpus in demo mode. (section, text)
GUIDES: dict[str, list[tuple[str, str]]] = {
    "jaipur": [
        ("Get around", "Auto-rickshaws and app cabs are the easiest way between forts and the Old City. Agree the fare before an auto ride, or use a ride-hailing app. The Old City is best covered on foot."),
        ("When to go", "October to March is cool and dry. April to June is very hot, so schedule forts for early morning and keep afternoons indoors. The monsoon from July to September is green but humid."),
        ("See", "Amber Fort opens at 8am and fills up by 11am, so arrive early. Combine Panna Meena ka Kund and Jal Mahal with the Amber trip since both are on the same road. Hawa Mahal looks best in morning light."),
        ("Eat", "Rajasthani thali, dal baati churma, pyaaz kachori and ghewar are local staples. Most traditional restaurants have vegetarian options, and many are fully vegetarian. Street food is best at busy stalls with high turnover."),
        ("Buy", "Block-printed textiles, blue pottery, lac bangles and jewellery are the usual buys. Bargain politely in Johari Bazaar; many Old City shops close on Sundays."),
        ("Respect", "Cover shoulders and knees at temples and palaces. Photography inside some halls needs a camera ticket. Elephant rides at Amber raise welfare concerns; walk or take a jeep instead."),
        ("Stay safe", "Drink bottled water, carry sun protection from March onwards and be wary of unsolicited guides near monuments. Keep valuables out of sight in crowded bazaars."),
    ],
    "goa": [
        ("Get around", "Distances are long. North Goa beaches like Baga, Anjuna and Vagator are close together, while Palolem in the south is about two hours away. Rent a scooter only with a valid licence and helmet, or use pre-paid taxis."),
        ("When to go", "November to February is the peak: dry, warm and busy. Shacks and water sports mostly shut during the monsoon from June to September, and rough seas make swimming unsafe."),
        ("See", "Old Goa's churches and Fontainhas in Panaji show the Portuguese side of Goa. Forts at Aguada and Chapora give sea views. Dudhsagar Falls needs a half-day jeep trip and is closed or dangerous in heavy monsoon."),
        ("Eat", "Goan fish curry rice, xacuti, bebinca and pork vindaloo are classic. Beach shacks lean on seafood, so vegetarians should check menus; Panaji thali houses and Indian-vegetarian cafes are reliable."),
        ("Nightlife", "Baga, Tito's Lane and Vagator are the main party areas. Prices and noise peak around New Year. Keep a registered taxi booked for the ride back."),
        ("Markets", "Anjuna's flea market runs on Wednesdays only. Mapusa's Friday market is the local option for spices and cashews."),
        ("Stay safe", "Obey red-flag warnings at beaches, avoid swimming at night and watch for strong currents. Keep copies of ID if renting vehicles."),
    ],
    "tokyo": [
        ("Get around", "Get a Suica or Pasmo card for trains and buses. Trains stop around midnight, so plan the return from late dinners. Station exits matter; check the exit number before walking."),
        ("When to go", "March to May and October to November are mild; early April cherry blossom and late November leaves draw crowds. Summer is hot and humid. Typhoons are possible in September."),
        ("See", "Senso-ji is calmest before 8am. Meiji Jingu pairs with Harajuku. teamLab Planets uses timed entry and sells out. Many museums close on Mondays; Tsukiji's outer market is quiet after lunch."),
        ("Eat", "Ramen shops often use ticket machines. Vegetarian and vegan travellers should look for shops that advertise vegan broth, since many soups use fish or pork stock. Convenience stores are a good cheap breakfast."),
        ("Etiquette", "No tipping, queue quietly and avoid eating while walking. Carry cash for small shops and shrines. Keep phone calls off trains."),
        ("Money", "Prices are moderate if you eat at ramen, sushi-train and set-meal places. Observation decks and immersive art venues are the big-ticket items."),
        ("Stay safe", "Tokyo is very safe at night. Earthquake drills are routine; follow hotel instructions and keep a power bank."),
    ],
    "paris": [
        ("Get around", "The Metro covers most of the city; buy a carnet or a Navigo Easy pass. Walking between the Louvre, the Seine and the Marais is pleasant. Versailles takes the RER C line."),
        ("When to go", "April to June and September to October are the best months. July and August are crowded, and some small restaurants close. Winter is grey but quiet, and museums are less busy."),
        ("See", "Book Eiffel Tower and Louvre tickets online for timed slots. The Louvre is closed on Tuesdays and Orsay on Mondays. Versailles is closed Mondays and is best by early morning."),
        ("Eat", "Cafes are expensive for sitting but good for a break. Bouillons serve cheaper classic dishes. Vegetarians do well in the Marais, where falafel counters are plentiful, but classic French menus lean heavily on meat."),
        ("Etiquette", "Greet shopkeepers with a bonjour. Tipping is optional because service is included. Many shops and some restaurants close on Sunday afternoons."),
        ("Stay safe", "Watch for pickpockets around Eiffel Tower, Sacré-Cœur and on the Metro. Ignore petition and bracelet scams."),
        ("Money", "Museum passes can save money if you plan three or more big museums. Many national museums are free for under-26 EU residents, not for most visitors."),
    ],
}

FX_TO_INR = {"INR": 1.0, "JPY": 0.56, "EUR": 91.0, "USD": 84.0}  # offline fallback only
