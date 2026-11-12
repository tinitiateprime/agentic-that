// Built-in topic library for Social SEO. Each topic lists the words that
// identify it ("triggers") and evergreen hashtags people actually follow for
// it. Tags are ordered from most specific to broadest. `triggerTags` gives an
// exact tag for a specific trigger word ("python" -> #Python). `local` tags are
// combined with the detected city ("{City}Foodies" -> #HyderabadFoodies).
//
// Only stable topic tags belong here, never trends that go stale. `intent`
// links a topic to the hook and call-to-action style in instagram-rules.js.

export const TOPICS = Object.freeze([
  // ---- Food ----------------------------------------------------------------
  { id: "biryani", intent: "food", emoji: "🍛", triggers: ["biryani", "dum biryani", "haleem", "pulao", "mandi"],
    tags: ["#BiryaniLovers", "#Biryani", "#HyderabadiBiryani"], triggerTags: { haleem: "#Haleem", mandi: "#Mandi" }, local: ["{City}Foodies", "{City}Food"] },
  { id: "indian-food", intent: "food", emoji: "🍛", triggers: ["paneer", "curry", "thali", "masala", "tandoori", "tikka", "naan", "roti", "paratha", "dal", "kebab", "kebabs", "kabab", "korma", "khichdi", "butter chicken", "chole", "rajma", "desi", "indian food", "north indian", "mughlai"],
    tags: ["#IndianFood", "#DesiFood", "#IndianCuisine", "#FoodLovers"], triggerTags: { paneer: "#PaneerLovers", "butter chicken": "#ButterChicken", tandoori: "#Tandoori" }, local: ["{City}Foodies", "{City}Food"] },
  { id: "south-indian", intent: "food", emoji: "🥘", triggers: ["dosa", "idli", "vada", "sambar", "uttapam", "appam", "pongal", "upma", "filter coffee", "south indian", "andhra", "chettinad", "kerala food"],
    tags: ["#SouthIndianFood", "#SouthIndianBreakfast", "#IndianFood"], triggerTags: { dosa: "#Dosa", "filter coffee": "#FilterCoffee" }, local: ["{City}Foodies", "{City}Food"] },
  { id: "street-food", intent: "food", emoji: "🌯", triggers: ["street food", "chaat", "pani puri", "golgappa", "vada pav", "pav bhaji", "momos", "momo", "rolls", "frankie", "bhel", "samosa", "kachori"],
    tags: ["#StreetFood", "#IndianStreetFood", "#StreetFoodLovers"], triggerTags: { momos: "#Momos", "pani puri": "#PaniPuri", "vada pav": "#VadaPav" }, local: ["{City}StreetFood", "{City}Foodies"] },
  { id: "sweets", intent: "food", emoji: "🍬", triggers: ["mithai", "sweets", "gulab jamun", "jalebi", "ladoo", "laddu", "rasgulla", "barfi", "kaju katli", "halwa", "kheer", "rasmalai", "double ka meetha", "meetha"],
    tags: ["#IndianSweets", "#Mithai", "#SweetTooth"], local: ["{City}Foodies"] },
  { id: "cafe-coffee", intent: "food", emoji: "☕", triggers: ["coffee", "cafe", "café", "latte", "cappuccino", "espresso", "cold brew", "barista", "chai", "tea", "matcha", "mocha", "coffee shop"],
    tags: ["#CoffeeLovers", "#CafeVibes", "#CoffeeTime", "#CafeHopping"], triggerTags: { "cold brew": "#ColdBrew", chai: "#ChaiLovers", matcha: "#Matcha", latte: "#LatteArt" }, local: ["{City}Cafes", "{City}Foodies"] },
  { id: "bakery", intent: "food", emoji: "🧁", triggers: ["cake", "cakes", "bakery", "pastry", "pastries", "croissant", "croissants", "cupcake", "cupcakes", "brownie", "brownies", "cookies", "cookie", "donut", "donuts", "doughnut", "cheesecake", "bread", "sourdough", "baked", "baking", "dessert", "desserts", "tart", "macarons"],
    tags: ["#Bakery", "#FreshlyBaked", "#Desserts", "#CakeLovers", "#SweetTooth"], triggerTags: { sourdough: "#Sourdough", brownie: "#Brownies", brownies: "#Brownies", cheesecake: "#Cheesecake", croissant: "#Croissants", croissants: "#Croissants", cupcakes: "#Cupcakes", "custom cakes": "#CustomCakes" }, local: ["{City}Bakery", "{City}Foodies"] },
  { id: "fast-food", intent: "food", emoji: "🍔", triggers: ["pizza", "burger", "burgers", "fries", "sandwich", "wrap", "shawarma", "pasta", "nachos", "tacos", "hot dog", "fried chicken", "wings"],
    tags: ["#FoodLovers", "#FoodieGram", "#Yummy"], triggerTags: { pizza: "#PizzaLovers", burger: "#BurgerLovers", burgers: "#BurgerLovers", shawarma: "#Shawarma", pasta: "#PastaLovers", tacos: "#Tacos", "fried chicken": "#FriedChicken" }, local: ["{City}Foodies", "{City}Food"] },
  { id: "healthy-food", intent: "food", minHits: 2, emoji: "🥗", triggers: ["salad", "healthy", "vegan", "keto", "smoothie", "oats", "millet", "millets", "gluten free", "plant based", "sugar free", "high protein", "clean eating", "nutrition", "diet"],
    tags: ["#HealthyEating", "#HealthyFood", "#CleanEating", "#Nutrition"], triggerTags: { vegan: "#VeganFood", keto: "#KetoDiet", millets: "#Millets", millet: "#Millets", smoothie: "#Smoothies", "high protein": "#HighProtein" }, local: ["{City}Foodies"] },
  { id: "restaurant", intent: "food", minHits: 2, emoji: "🍽️", triggers: ["restaurant", "dine in", "dining", "fine dining", "buffet", "brunch", "dinner", "lunch", "menu", "chef", "cloud kitchen", "food delivery", "takeaway", "rooftop", "family restaurant"],
    tags: ["#FoodLovers", "#FoodieGram", "#EatOut"], triggerTags: { buffet: "#Buffet", brunch: "#Brunch", "fine dining": "#FineDining", rooftop: "#RooftopDining" }, local: ["{City}Foodies", "{City}Restaurants", "{City}Food"] },
  { id: "recipe", intent: "recipe", emoji: "👩‍🍳", triggers: ["recipe", "recipes", "ingredients", "homemade", "home made", "cook", "cooking", "tbsp", "tsp", "teaspoon", "tablespoon", "marinate", "easy recipe", "quick recipe", "air fryer"],
    tags: ["#EasyRecipes", "#HomeCooking", "#RecipeOfTheDay", "#Homemade", "#FoodBlogger"], triggerTags: { "air fryer": "#AirFryerRecipes" } },

  // ---- Learning, tech and careers -------------------------------------------
  { id: "coding", intent: "education", emoji: "💻", triggers: ["coding", "code", "programming", "programmer", "developer", "developers", "python", "java", "javascript", "react", "node", "typescript", "html", "css", "software", "full stack", "fullstack", "web development", "app development", "frontend", "backend", "apis", "api", "dsa", "data structures"],
    tags: ["#LearnToCode", "#Coding", "#Programming", "#Developer", "#SoftwareDevelopment"], triggerTags: { python: "#Python", javascript: "#JavaScript", java: "#Java", react: "#ReactJS", "full stack": "#FullStackDeveloper", fullstack: "#FullStackDeveloper", "web development": "#WebDevelopment", "app development": "#AppDevelopment", dsa: "#DSA", typescript: "#TypeScript", apis: "#APIs", api: "#APIs" } },
  { id: "data", intent: "education", emoji: "📊", triggers: ["data", "data analytics", "data science", "analytics", "sql", "power bi", "tableau", "excel", "machine learning", "statistics", "data analyst", "big data", "data engineering"],
    tags: ["#DataAnalytics", "#DataScience", "#DataAnalyst", "#BigData"], triggerTags: { sql: "#SQL", "power bi": "#PowerBI", tableau: "#Tableau", excel: "#Excel", "machine learning": "#MachineLearning", "data science": "#DataScience", "data engineering": "#DataEngineering" } },
  { id: "cloud", intent: "education", emoji: "☁️", triggers: ["cloud", "cloud computing", "aws", "azure", "gcp", "google cloud", "devops", "kubernetes", "docker", "terraform", "linux"],
    tags: ["#CloudComputing", "#DevOps", "#Cloud"], triggerTags: { aws: "#AWS", azure: "#Azure", gcp: "#GoogleCloud", "google cloud": "#GoogleCloud", kubernetes: "#Kubernetes", docker: "#Docker", linux: "#Linux" } },
  { id: "ai", intent: "education", emoji: "🤖", triggers: ["ai", "artificial intelligence", "genai", "gen ai", "generative ai", "chatgpt", "llm", "llms", "ai workflows", "ai tools", "ai agents", "automation", "prompt engineering", "deep learning", "neural networks"],
    tags: ["#ArtificialIntelligence", "#GenerativeAI", "#AITools", "#Automation", "#FutureOfWork"], triggerTags: { chatgpt: "#ChatGPT", "prompt engineering": "#PromptEngineering", "deep learning": "#DeepLearning", "ai agents": "#AIAgents" } },
  { id: "cybersecurity", intent: "education", emoji: "🔐", triggers: ["cybersecurity", "cyber security", "ethical hacking", "hacking", "infosec", "penetration testing", "network security", "soc analyst"],
    tags: ["#CyberSecurity", "#EthicalHacking", "#InfoSec"] },
  { id: "career", intent: "education", emoji: "🚀", triggers: ["career", "careers", "upskill", "upskilling", "skill", "skills", "skill stack", "job ready", "placement", "placements", "internship", "internships", "resume", "interview", "interviews", "freshers", "career growth", "future-proof", "reskill"],
    tags: ["#CareerGrowth", "#Upskilling", "#CareerTips", "#TechCareers", "#SkillDevelopment"], triggerTags: { internship: "#Internship", internships: "#Internship", resume: "#ResumeTips", interview: "#InterviewTips", interviews: "#InterviewTips", freshers: "#Freshers" } },
  { id: "courses", intent: "education", minHits: 2, weight: 0.6, emoji: "📚", triggers: ["course", "courses", "training", "bootcamp", "certification", "certified", "classes", "class", "batch", "enroll", "enrol", "admission", "admissions", "academy", "institute", "learn", "learning", "students", "student", "workshop", "online course", "online courses", "online classes", "live classes", "mentorship", "curriculum"],
    tags: ["#LearnSomethingNew", "#Education", "#SkillDevelopment", "#Students"], triggerTags: { bootcamp: "#Bootcamp", certification: "#Certification", workshop: "#Workshop", "online course": "#OnlineLearning", "online courses": "#OnlineLearning", "online classes": "#OnlineLearning", "live classes": "#OnlineLearning" } },
  { id: "exam-prep", intent: "education", emoji: "📝", triggers: ["exam", "exams", "neet", "jee", "upsc", "gate", "ssc", "cat exam", "board exams", "coaching", "tuition", "tuitions", "mock test", "syllabus", "study tips", "ias", "bank exams"],
    tags: ["#ExamPreparation", "#StudyMotivation", "#StudyTips", "#Students"], triggerTags: { neet: "#NEET", jee: "#JEE", upsc: "#UPSC", gate: "#GATE", ssc: "#SSC", ias: "#IAS" } },
  { id: "languages", intent: "education", emoji: "🗣️", triggers: ["english speaking", "spoken english", "ielts", "toefl", "pte", "german", "french", "japanese", "language classes", "communication skills", "public speaking"],
    tags: ["#SpokenEnglish", "#LanguageLearning", "#CommunicationSkills"], triggerTags: { ielts: "#IELTS", toefl: "#TOEFL", pte: "#PTE", german: "#LearnGerman", french: "#LearnFrench", "public speaking": "#PublicSpeaking" } },
  { id: "digital-marketing", intent: "education", emoji: "📈", triggers: ["digital marketing", "seo", "social media marketing", "marketing", "branding", "ads", "meta ads", "google ads", "content creation", "content creator", "instagram growth", "lead generation", "performance marketing", "copywriting"],
    tags: ["#DigitalMarketing", "#SocialMediaMarketing", "#MarketingTips", "#ContentCreator", "#Branding"], triggerTags: { seo: "#SEO", "google ads": "#GoogleAds", "meta ads": "#MetaAds", copywriting: "#Copywriting", "lead generation": "#LeadGeneration" } },
  { id: "startup", intent: "announcement", emoji: "🚀", triggers: ["startup", "startups", "founder", "founders", "entrepreneur", "entrepreneurs", "entrepreneurship", "small business", "fundraising", "product-market fit", "saas", "b2b", "bootstrapped", "funding", "investors", "pitch"],
    tags: ["#Startup", "#Entrepreneur", "#StartupLife", "#Founders", "#SmallBusiness"], triggerTags: { saas: "#SaaS", fundraising: "#Fundraising", "small business": "#SmallBusiness" }, local: ["{City}Startups"] },
  { id: "finance", intent: "tutorial", emoji: "💰", triggers: ["investing", "investment", "investments", "stock market", "stocks", "mutual funds", "mutual fund", "sip", "trading", "personal finance", "tax", "income tax", "gst", "savings", "insurance", "loan", "loans", "credit card", "credit score", "financial planning", "retirement", "crypto", "budget", "budgeting"],
    tags: ["#PersonalFinance", "#Investing", "#FinancialFreedom", "#MoneyTips", "#FinancialLiteracy"], triggerTags: { "stock market": "#StockMarket", "mutual funds": "#MutualFunds", "mutual fund": "#MutualFunds", sip: "#SIP", trading: "#Trading", gst: "#GST", "income tax": "#IncomeTax", insurance: "#Insurance", crypto: "#Crypto", "credit score": "#CreditScore" } },

  // ---- Fitness, health and beauty --------------------------------------------
  { id: "gym", intent: "fitness", emoji: "💪", triggers: ["gym", "workout", "workouts", "fitness", "strength", "weights", "crossfit", "personal trainer", "trainer", "fat loss", "weight loss", "muscle", "bodybuilding", "cardio", "hiit", "abs", "squats", "deadlift", "transformation", "strength training"],
    tags: ["#FitnessMotivation", "#GymLife", "#Workout", "#FitnessJourney", "#HealthyLifestyle"], triggerTags: { "strength training": "#StrengthTraining", "fat loss": "#FatLoss", "weight loss": "#WeightLoss", "personal trainer": "#PersonalTrainer", crossfit: "#CrossFit", transformation: "#TransformationTuesday", hiit: "#HIIT" }, local: ["{City}Fitness", "{City}Gym"] },
  { id: "yoga", intent: "fitness", emoji: "🧘", triggers: ["yoga", "meditation", "pranayama", "asana", "asanas", "mindfulness", "breathwork", "pilates", "zumba"],
    tags: ["#Yoga", "#YogaPractice", "#Meditation", "#Mindfulness", "#YogaEveryday"], triggerTags: { pilates: "#Pilates", zumba: "#Zumba" }, local: ["{City}Yoga"] },
  { id: "sports", intent: "fitness", emoji: "🏏", triggers: ["running", "marathon", "cycling", "cricket", "football", "badminton", "tennis", "swimming", "pickleball", "basketball", "volleyball", "sports academy", "coaching camp", "turf"],
    tags: ["#Sports", "#SportsTraining", "#Athlete"], triggerTags: { running: "#Running", marathon: "#Marathon", cycling: "#Cycling", cricket: "#Cricket", football: "#Football", badminton: "#Badminton", tennis: "#Tennis", swimming: "#Swimming", pickleball: "#Pickleball", turf: "#BoxCricket" }, local: ["{City}Sports"] },
  { id: "healthcare", intent: "service", emoji: "🩺", cta: "📅 DM us to book an appointment.", triggers: ["smile makeover", "smile makeovers", "aligners", "clear aligners", "teeth whitening", "root canal", "braces", "dental implants", "implants", "dental clinic", "doctor", "doctors", "clinic", "hospital", "dental", "dentist", "teeth", "physiotherapy", "physio", "dermatologist", "health checkup", "ayurveda", "homeopathy", "mental health", "therapy", "therapist", "diabetes", "pcos", "pregnancy", "eye care", "orthopedic"],
    tags: ["#Healthcare", "#HealthTips", "#Wellness", "#HealthyLiving"], triggerTags: { "clear aligners": "#ClearAligners", aligners: "#ClearAligners", "teeth whitening": "#TeethWhitening", "smile makeover": "#SmileMakeover", "smile makeovers": "#SmileMakeover", "root canal": "#RootCanal", braces: "#Braces", "dental implants": "#DentalImplants", implants: "#DentalImplants", "dental clinic": "#DentalClinic", dental: "#DentalCare", dentist: "#Dentist", teeth: "#DentalCare", physiotherapy: "#Physiotherapy", physio: "#Physiotherapy", ayurveda: "#Ayurveda", homeopathy: "#Homeopathy", "mental health": "#MentalHealthMatters", therapy: "#MentalHealthMatters", pcos: "#PCOS", diabetes: "#Diabetes" }, local: ["{City}Doctors"] },
  { id: "makeup", intent: "beauty", emoji: "💄", triggers: ["makeup", "make up", "bridal makeup", "mua", "makeup artist", "glam", "hd makeup", "airbrush", "engagement makeup", "party makeup"],
    tags: ["#MakeupArtist", "#BridalMakeup", "#MakeupLook", "#GlamMakeup"], triggerTags: { "hd makeup": "#HDMakeup", airbrush: "#AirbrushMakeup", "bridal makeup": "#BridalMakeup" }, local: ["{City}MakeupArtist"] },
  { id: "skincare", intent: "beauty", emoji: "🧴", triggers: ["skincare", "skin care", "skin", "glow", "serum", "sunscreen", "acne", "facial", "moisturizer", "moisturiser", "pigmentation", "anti aging", "hydrafacial", "chemical peel"],
    tags: ["#Skincare", "#SkincareRoutine", "#GlowingSkin", "#HealthySkin"], triggerTags: { hydrafacial: "#HydraFacial", acne: "#AcneTreatment", sunscreen: "#Sunscreen" }, local: ["{City}Skincare"] },
  { id: "hair", intent: "beauty", emoji: "💇", triggers: ["hair", "haircut", "hairstyle", "hair color", "hair colour", "keratin", "smoothening", "hair spa", "balayage", "highlights", "hair care", "hair fall", "hair treatment"],
    tags: ["#HairTransformation", "#HairStyle", "#HairGoals", "#HairCare"], triggerTags: { balayage: "#Balayage", keratin: "#KeratinTreatment", "hair color": "#HairColor", "hair colour": "#HairColor", haircut: "#Haircut" }, local: ["{City}Salon", "{City}HairStylist"] },
  { id: "nails", intent: "beauty", emoji: "💅", triggers: ["nails", "nail art", "manicure", "pedicure", "nail extensions", "gel nails", "acrylic nails"],
    tags: ["#NailArt", "#NailsOfInstagram", "#NailDesign", "#Nails"], triggerTags: { "gel nails": "#GelNails", "acrylic nails": "#AcrylicNails", "nail extensions": "#NailExtensions" }, local: ["{City}Nails"] },
  { id: "salon", intent: "beauty", emoji: "✨", triggers: ["salon", "spa", "massage", "parlour", "parlor", "beauty salon", "unisex salon", "grooming", "waxing", "threading"],
    tags: ["#SalonLife", "#SpaDay", "#SelfCare", "#BeautySalon"], local: ["{City}Salon"] },

  // ---- Fashion ----------------------------------------------------------------
  { id: "ethnic-wear", intent: "sale", emoji: "🥻", triggers: ["saree", "sarees", "kurti", "kurtis", "lehenga", "lehengas", "salwar", "anarkali", "ethnic wear", "kurta", "kurtas", "sherwani", "dupatta", "handloom", "block print", "block printed", "silk", "cotton sarees", "banarasi", "kanjeevaram", "ikat", "chikankari"],
    tags: ["#EthnicWear", "#IndianWear", "#Handloom", "#TraditionalWear", "#DesiStyle"], triggerTags: { saree: "#SareeLove", sarees: "#SareeLove", kurti: "#Kurti", kurtis: "#Kurtis", lehenga: "#Lehenga", lehengas: "#Lehenga", banarasi: "#BanarasiSaree", kanjeevaram: "#Kanjeevaram", chikankari: "#Chikankari", "block printed": "#BlockPrint", "block print": "#BlockPrint", ikat: "#Ikat" } },
  { id: "fashion", intent: "sale", emoji: "👗", triggers: ["dress", "dresses", "outfit", "outfits", "ootd", "tops", "jeans", "streetwear", "menswear", "womenswear", "sneakers", "shoes", "footwear", "bags", "handbag", "handbags", "fashion", "clothing", "apparel", "co-ord", "co ord", "t-shirts", "tshirts", "hoodies"],
    tags: ["#FashionStyle", "#OOTD", "#StyleInspo", "#FashionBrand", "#Fashion"], triggerTags: { sneakers: "#Sneakers", streetwear: "#Streetwear", menswear: "#Menswear", handbags: "#Handbags", footwear: "#Footwear" } },
  { id: "jewellery", intent: "sale", emoji: "💍", triggers: ["jewellery", "jewelry", "earrings", "necklace", "rings", "bangles", "gold", "silver", "diamond", "diamonds", "kundan", "oxidised", "oxidized", "temple jewellery", "bridal jewellery", "polki", "antique jewellery"],
    tags: ["#Jewellery", "#JewelleryDesign", "#Jewelry", "#JewelleryLovers"], triggerTags: { earrings: "#Earrings", gold: "#GoldJewellery", silver: "#SilverJewellery", kundan: "#KundanJewellery", oxidised: "#OxidisedJewellery", diamond: "#DiamondJewellery", "temple jewellery": "#TempleJewellery", polki: "#PolkiJewellery" } },

  // ---- Home and property --------------------------------------------------------
  { id: "real-estate", intent: "realestate", emoji: "🏡", triggers: ["apartment", "apartments", "flats", "villa", "villas", "plot", "plots", "bhk", "property", "properties", "real estate", "gated community", "possession", "sqft", "sq ft", "rera", "open plots", "commercial space", "office space", "independent house", "duplex", "ready to move", "new launch", "swimming pool", "clubhouse", "2bhk", "3bhk", "4bhk", "1bhk"],
    tags: ["#RealEstate", "#PropertyForSale", "#DreamHome", "#NewHome", "#LuxuryHomes"], triggerTags: { villa: "#LuxuryVillas", villas: "#LuxuryVillas", plots: "#OpenPlots", "open plots": "#OpenPlots", "gated community": "#GatedCommunity", "commercial space": "#CommercialProperty" }, local: ["{City}RealEstate", "{City}Properties", "{City}Homes"] },
  { id: "interior", intent: "service", emoji: "🛋️", cta: "📩 DM us for a free design consultation.", triggers: ["interior", "interiors", "interior design", "decor", "home decor", "modular kitchen", "living room", "bedroom", "furniture", "sofa", "wardrobe", "renovation", "false ceiling", "home makeover", "lighting", "wallpaper"],
    tags: ["#InteriorDesign", "#HomeDecor", "#InteriorDesigner", "#HomeInspo", "#InteriorInspiration"], triggerTags: { "modular kitchen": "#ModularKitchen", furniture: "#FurnitureDesign", renovation: "#HomeRenovation" }, local: ["{City}Interiors", "{City}InteriorDesigner"] },
  { id: "home-services", intent: "service", emoji: "🧹", cta: "📞 DM us to book a service.", triggers: ["cleaning", "deep cleaning", "pest control", "plumbing", "plumber", "electrician", "ac service", "ac repair", "painting services", "carpenter", "laundry", "dry cleaning", "packers", "movers", "home services", "appliance repair"],
    tags: ["#HomeServices", "#CleaningServices", "#HomeCare"], triggerTags: { "pest control": "#PestControl", "ac service": "#ACService", "ac repair": "#ACRepair", laundry: "#LaundryService", movers: "#PackersAndMovers", packers: "#PackersAndMovers", "deep cleaning": "#DeepCleaning" }, local: ["{City}Services"] },

  // ---- Travel, events and occasions -------------------------------------------
  { id: "mountains", intent: "travel", emoji: "🏔️", triggers: ["trek", "trekking", "himalaya", "himalayas", "himalayan", "mountains", "mountain", "hiking", "summit", "camping", "snow", "hill station", "valley"],
    tags: ["#Trekking", "#Himalayas", "#MountainLovers", "#Hiking", "#Wanderlust"], triggerTags: { camping: "#Camping", snow: "#SnowLovers" } },
  { id: "beach", intent: "travel", emoji: "🏖️", triggers: ["beach", "beaches", "island", "goa", "sea", "coast", "scuba", "snorkeling", "surfing", "maldives", "andaman", "bali"],
    tags: ["#BeachVibes", "#BeachLife", "#IslandLife", "#Wanderlust"], triggerTags: { goa: "#Goa", maldives: "#Maldives", andaman: "#Andaman", bali: "#Bali", scuba: "#ScubaDiving", surfing: "#Surfing" } },
  { id: "travel", intent: "travel", emoji: "✈️", triggers: ["travel", "trip", "vacation", "holiday", "itinerary", "tour", "tours", "destination", "road trip", "solo travel", "hotel", "resort", "staycation", "backpacking", "travel guide", "weekend getaway", "honeymoon", "tour package"],
    tags: ["#TravelDiaries", "#Wanderlust", "#TravelGram", "#TravelIndia", "#ExploreMore"], triggerTags: { "road trip": "#RoadTrip", "solo travel": "#SoloTravel", staycation: "#Staycation", honeymoon: "#HoneymoonDestination", resort: "#ResortLife", backpacking: "#Backpacking" } },
  { id: "events", intent: "event", emoji: "🎟️", triggers: ["meetup", "conference", "summit", "webinar", "hackathon", "expo", "seminar", "networking", "masterclass", "panel", "keynote", "tech event", "community event", "launch event"],
    tags: ["#Networking", "#TechCommunity", "#EventAlert", "#Meetup"], triggerTags: { hackathon: "#Hackathon", webinar: "#Webinar", conference: "#Conference", masterclass: "#Masterclass", expo: "#Expo" }, local: ["{City}Events"] },
  { id: "wedding", intent: "event", minHits: 2, emoji: "💍", triggers: ["wedding", "weddings", "shaadi", "engagement", "haldi", "mehendi", "mehndi", "sangeet", "reception", "bride", "groom", "pre wedding", "prewedding", "wedding planner", "baraat", "vidaai", "bridal"],
    tags: ["#IndianWedding", "#WeddingInspiration", "#BigFatIndianWedding", "#WeddingDiaries"], triggerTags: { haldi: "#HaldiCeremony", mehendi: "#MehendiCeremony", mehndi: "#MehendiCeremony", sangeet: "#Sangeet", "pre wedding": "#PreWeddingShoot", prewedding: "#PreWeddingShoot", "wedding planner": "#WeddingPlanner", bride: "#IndianBride", groom: "#IndianGroom" }, local: ["{City}Weddings"] },
  { id: "nightlife", intent: "event", emoji: "🎶", triggers: ["party", "dj", "concert", "live music", "gig", "nightlife", "club", "open mic", "standup", "stand-up", "comedy show", "karaoke"],
    tags: ["#LiveMusic", "#Nightlife", "#WeekendVibes", "#PartyTime"], triggerTags: { "open mic": "#OpenMic", standup: "#StandUpComedy", "stand-up": "#StandUpComedy", "comedy show": "#StandUpComedy", karaoke: "#Karaoke", concert: "#Concert" }, local: ["{City}Events", "{City}Nightlife"] },
  { id: "photography", intent: "general", emoji: "📸", cta: "📩 DM us to check available dates.", triggers: ["photography", "photographer", "photoshoot", "photo shoot", "portrait", "portraits", "candid", "maternity shoot", "newborn shoot", "product photography", "cinematic", "videography", "drone shot"],
    tags: ["#Photography", "#Photographer", "#PortraitPhotography", "#PhotoOfTheDay"], triggerTags: { "maternity shoot": "#MaternityShoot", "newborn shoot": "#NewbornPhotography", "product photography": "#ProductPhotography", videography: "#Videography", candid: "#CandidPhotography" }, local: ["{City}Photographer"] },
  { id: "festivals", intent: "greeting", emoji: "🎉", triggers: ["diwali", "deepavali", "holi", "eid", "ramadan", "ramzan", "christmas", "navratri", "durga puja", "ganesh chaturthi", "ganesh", "pongal", "sankranti", "onam", "rakhi", "raksha bandhan", "dussehra", "ugadi", "new year", "valentine", "valentines", "mother's day", "father's day", "independence day", "republic day", "karwa chauth", "bathukamma", "lohri", "baisakhi"],
    tags: ["#FestiveSeason", "#Festival", "#Celebration"], triggerTags: { diwali: ["#HappyDiwali", "#Diwali", "#FestivalOfLights"], deepavali: ["#HappyDiwali", "#Deepavali"], holi: ["#HappyHoli", "#Holi"], eid: "#EidMubarak", ramadan: "#RamadanKareem", ramzan: "#RamadanKareem", christmas: "#MerryChristmas", navratri: "#Navratri", "durga puja": "#DurgaPuja", "ganesh chaturthi": "#GaneshChaturthi", pongal: "#HappyPongal", sankranti: "#HappySankranti", onam: "#HappyOnam", rakhi: "#RakshaBandhan", "raksha bandhan": "#RakshaBandhan", dussehra: "#HappyDussehra", ugadi: "#HappyUgadi", "new year": "#HappyNewYear", valentine: "#ValentinesDay", valentines: "#ValentinesDay", "mother's day": "#MothersDay", "father's day": "#FathersDay", "independence day": "#IndependenceDay", "republic day": "#RepublicDay", bathukamma: "#Bathukamma", lohri: "#HappyLohri", baisakhi: "#Baisakhi" } },

  // ---- Everyday niches ------------------------------------------------------------
  { id: "pets", intent: "pets", emoji: "🐾", emojis: ["🐶", "🐕", "🐱", "🐈", "🐾", "🐩", "🐾"], triggers: ["furry friend", "furry", "fur baby", "paws", "pup", "grooming session", "pet spa", "dog", "dogs", "puppy", "puppies", "cat", "cats", "kitten", "kittens", "pet", "pets", "pet grooming", "vet", "pet food", "dog training"],
    tags: ["#PetLovers", "#PetsOfInstagram", "#PetCare"], triggerTags: { "🐶": "#DogsOfInstagram", "🐕": "#DogsOfInstagram", "🐱": "#CatsOfInstagram", "🐈": "#CatsOfInstagram", dog: "#DogsOfInstagram", dogs: "#DogsOfInstagram", puppy: "#PuppyLove", puppies: "#PuppyLove", cat: "#CatsOfInstagram", cats: "#CatsOfInstagram", kitten: "#CatsOfInstagram", "pet grooming": "#PetGrooming", "dog training": "#DogTraining" }, local: ["{City}Pets"] },
  { id: "kids", intent: "general", emoji: "🧸", triggers: ["kids", "children", "child", "baby", "babies", "toddler", "toddlers", "parenting", "mom", "moms", "mommy", "preschool", "playschool", "daycare", "summer camp", "kids activities", "newborn"],
    tags: ["#Parenting", "#KidsActivities", "#MomLife", "#ParentingTips"], triggerTags: { preschool: "#Preschool", playschool: "#Preschool", "summer camp": "#SummerCamp", toddler: "#ToddlerActivities", newborn: "#NewbornBaby" }, local: ["{City}Moms", "{City}Kids"] },
  { id: "automotive", intent: "service", emoji: "🚗", cta: "📅 DM us to book your slot.", triggers: ["car", "cars", "bike", "bikes", "motorcycle", "suv", "ev", "electric vehicle", "electric car", "test drive", "car service", "detailing", "car detailing", "ceramic coating", "ppf", "tyres", "tires", "car wash", "royal enfield", "superbike"],
    tags: ["#CarLovers", "#CarsOfInstagram", "#AutoLovers", "#CarCare"], triggerTags: { bike: "#BikeLovers", bikes: "#BikeLovers", motorcycle: "#BikeLovers", ev: "#ElectricVehicle", "electric vehicle": "#ElectricVehicle", "electric car": "#ElectricVehicle", detailing: "#CarDetailing", "car detailing": "#CarDetailing", "ceramic coating": "#CeramicCoating", ppf: "#PaintProtectionFilm", "royal enfield": "#RoyalEnfield", superbike: "#Superbikes" }, local: ["{City}Cars"] },
  { id: "gadgets", intent: "sale", emoji: "📱", triggers: ["smartphone", "phone", "iphone", "android", "laptop", "laptops", "gadget", "gadgets", "headphones", "earbuds", "smartwatch", "unboxing", "tech review", "accessories", "mobile accessories", "gaming", "console", "pc build"],
    tags: ["#TechGadgets", "#Gadgets", "#TechReview", "#Technology"], triggerTags: { iphone: "#iPhone", android: "#Android", unboxing: "#Unboxing", laptop: "#Laptop", smartwatch: "#Smartwatch", gaming: "#Gaming", "pc build": "#PCBuild" } },
  { id: "handmade", intent: "sale", emoji: "🎨", triggers: ["handmade", "hand made", "art", "painting", "paintings", "sketch", "illustration", "craft", "crafts", "pottery", "resin", "resin art", "candles", "crochet", "embroidery", "customised", "customized", "personalised", "personalized", "gift", "gifts", "gift hamper", "hampers", "return gifts", "mandala", "calligraphy"],
    tags: ["#HandmadeWithLove", "#Handmade", "#ShopSmall", "#GiftIdeas", "#ArtistsOnInstagram"], triggerTags: { resin: "#ResinArt", "resin art": "#ResinArt", pottery: "#Pottery", crochet: "#Crochet", embroidery: "#Embroidery", candles: "#HandmadeCandles", hampers: "#GiftHampers", "gift hamper": "#GiftHampers", "return gifts": "#ReturnGifts", calligraphy: "#Calligraphy", mandala: "#MandalaArt", painting: "#Painting", illustration: "#Illustration", personalised: "#PersonalisedGifts", personalized: "#PersonalizedGifts", customised: "#CustomisedGifts", customized: "#CustomizedGifts" } },
  { id: "music-dance", intent: "general", emoji: "🎵", triggers: ["music", "song", "songs", "singing", "singer", "guitar", "piano", "keyboard", "violin", "tabla", "dance", "dancing", "choreography", "bharatanatyam", "kathak", "hip hop", "music classes", "dance classes", "cover song"],
    tags: ["#Music", "#Musician", "#Dance", "#DanceVideo"], triggerTags: { guitar: "#Guitar", piano: "#Piano", singing: "#Singing", choreography: "#Choreography", bharatanatyam: "#Bharatanatyam", kathak: "#Kathak", "cover song": "#CoverSong", "hip hop": "#HipHopDance" }, local: ["{City}Music", "{City}Dance"] },
  { id: "spiritual", intent: "general", emoji: "🙏", triggers: ["temple", "temples", "pooja", "puja", "god", "devotional", "spiritual", "spirituality", "bhakti", "darshan", "prayer", "blessings", "astrology", "vastu"],
    tags: ["#Spirituality", "#Devotional", "#Blessed", "#IncredibleIndia"], triggerTags: { temple: "#TemplesOfIndia", temples: "#TemplesOfIndia", astrology: "#Astrology", vastu: "#Vastu" } },
  { id: "motivation", intent: "general", emoji: "🔥", triggers: ["motivation", "mindset", "discipline", "self improvement", "productivity", "habits", "growth mindset", "success", "goals", "consistency", "hustle", "self growth", "personal growth"],
    tags: ["#MindsetMatters", "#SelfImprovement", "#Productivity", "#PersonalGrowth", "#Consistency"], triggerTags: { productivity: "#ProductivityTips", habits: "#HabitBuilding", discipline: "#Discipline" } },
  { id: "work-life", intent: "general", emoji: "🏡", triggers: ["work from home", "wfh", "remote work", "standing desk", "home office", "desk setup", "office setup", "posture", "back pain", "ergonomic", "workspace"],
    tags: ["#WorkFromHome", "#HomeOffice", "#DeskSetup", "#RemoteWork"], triggerTags: { "standing desk": "#StandingDesk", posture: "#PostureCorrection", "back pain": "#BackPainRelief", ergonomic: "#Ergonomics" } },
  { id: "shopping", intent: "sale", minHits: 2, emoji: "🛍️", triggers: ["sale", "offer", "offers", "discount", "discounts", "shop now", "order now", "free shipping", "free delivery", "cod", "cash on delivery", "new arrivals", "new arrival", "new collection", "limited stock", "flat off", "buy 1 get 1", "bogo", "festive sale", "clearance"],
    tags: ["#ShopOnline", "#SaleAlert", "#NewArrivals", "#ShopSmall", "#SupportSmallBusiness"], triggerTags: { "new arrivals": "#NewArrivals", "new collection": "#NewCollection", clearance: "#ClearanceSale" } },
  { id: "jobs", intent: "jobs", minHits: 2, emoji: "💼", triggers: ["hiring", "we're hiring", "vacancy", "vacancies", "job opening", "job openings", "openings", "recruitment", "recruiting", "apply now", "join our team", "freshers", "walk-in", "walk in interview", "remote friendly", "remote role", "full time", "part time"],
    tags: ["#Hiring", "#NowHiring", "#JobOpening", "#CareerOpportunities", "#JobSearch"], triggerTags: { "remote friendly": "#RemoteJobs", "remote role": "#RemoteJobs", freshers: "#FreshersJobs", "walk in interview": "#WalkInInterview" }, local: ["{City}Jobs"] },
]);

// Emoji for list bullets, by item word. Falls back to the topic emoji, then ✅.
export const ITEM_EMOJI = Object.freeze({
  coding: "💻", code: "💻", programming: "💻", python: "🐍", java: "☕", javascript: "🟨", react: "⚛️", apis: "🔗", api: "🔗",
  data: "📊", analytics: "📊", "data analytics": "📊", sql: "🗄️", excel: "📗", cloud: "☁️", aws: "☁️", devops: "⚙️", ai: "🤖",
  "ai workflows": "🤖", "machine learning": "🧠", security: "🔐", cybersecurity: "🔐", design: "🎨", marketing: "📈", seo: "🔎",
  paneer: "🧀", butter: "🧈", tomatoes: "🍅", tomato: "🍅", cashews: "🥜", cream: "🥛", onion: "🧅", onions: "🧅", garlic: "🧄",
  chicken: "🍗", rice: "🍚", eggs: "🥚", egg: "🥚", milk: "🥛", sugar: "🍬", lemon: "🍋", chilli: "🌶️", chillies: "🌶️",
  coffee: "☕", tea: "🍵", cake: "🍰", pizza: "🍕", burger: "🍔", salad: "🥗", fruits: "🍎", fish: "🐟",
  clubhouse: "🏛️", "swimming pool": "🏊", pool: "🏊", gym: "🏋️", parking: "🅿️", garden: "🌳", park: "🌳",
  wifi: "📶", "power backup": "🔋", lift: "🛗", "24/7 security": "🔐", "play area": "🛝",
  "free shipping": "🚚", "free delivery": "🚚", cod: "💵", "easy returns": "↩️", sizes: "📏",
  fundraising: "💸", "product-market fit": "🎯", hiring: "🧑‍💼", networking: "🤝", talks: "🎤",
  makeup: "💄", hair: "💇", nails: "💅", skincare: "🧴", "hair styling": "💇", "hd makeup": "💄",
  typescript: "🟦", "node.js": "🟩", node: "🟩", remote: "🌍",
});

const CITY_TEMPLATE = /\{City\}/g;

function tokens(text) {
  return ` ${String(text).toLowerCase().normalize("NFKC").replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'+#.-]+/gu, " ").replace(/[.'-]+(?=\s|$)/g, "").replace(/\s+/g, " ").trim()} `;
}

export function hasTrigger(haystack, trigger) {
  const t = trigger.toLowerCase();
  if (haystack.includes(` ${t} `)) return true;
  // Simple plural/singular match for single words: "cake" ~ "cakes".
  if (!t.includes(" ") && t.length > 3 && !t.endsWith("s")) return haystack.includes(` ${t}s `);
  return false;
}

/**
 * Topics found in the text, strongest first. Triggers found in the opening
 * sentence or the main keyword count double, so the post's subject outranks
 * passing mentions.
 */
export function matchTopics(text, { emphasis = "", keyword = "", intentId = "" } = {}) {
  const haystack = tokens(text);
  const emphasised = tokens(emphasis);
  const keywordTokens = tokens(keyword);
  const raw = TOPICS.map((topic) => ({
    topic,
    hits: [...topic.triggers.filter((trigger) => hasTrigger(haystack, trigger)), ...new Set((topic.emojis || []).filter((emoji) => String(text).includes(emoji)))],
  }));
  // A word inside a longer matched phrase only counts as that phrase:
  // "training" in "strength training", "swimming" in "swimming pool".
  const allHits = raw.flatMap((entry) => entry.hits);
  const insideLonger = (hit) => allHits.some((other) => other !== hit && other.length > hit.length && ` ${other} `.includes(` ${hit} `));
  // A word listed under several topics ("summit": mountains and events) belongs
  // to the topic with the most other evidence.
  const support = new Map(raw.map((entry) => [entry.topic.id, entry.hits.filter((hit) => !insideLonger(hit)).length]));
  const owner = new Map();
  for (const entry of raw) {
    for (const hit of entry.hits) {
      const current = owner.get(hit);
      if (!current || support.get(entry.topic.id) > support.get(current)) owner.set(hit, entry.topic.id);
    }
  }
  const results = [];
  for (const { topic, hits: found } of raw) {
    const seen = new Set();
    const hits = found.filter((hit) => {
      if (insideLonger(hit) || owner.get(hit) !== topic.id) return false;
      const stem = hit.replace(/s$/, "");
      if (seen.has(stem)) return false;
      seen.add(stem);
      return true;
    });
    // General topics need two clues, unless the post type already says so.
    if (hits.length < (topic.intent === intentId ? 1 : topic.minHits || 1)) continue;
    const distinct = hits;
    const score = distinct.reduce((sum, hit) => sum + (hasTrigger(emphasised, hit) ? 2 : 1) + (hit.includes(" ") ? 0.5 : 0), 0) * (topic.weight || 1) + (topic.intent === intentId ? 2 : 0);
    // Exact tags for a trigger ("#Python"); marked strong when the trigger is the
    // post's subject (opening sentence or main keyword).
    const triggerTags = [...new Map(found.filter((hit) => topic.triggerTags?.[hit]).flatMap((hit) => [].concat(topic.triggerTags[hit]).map((tag, index) => [tag, { tag, hit, index, strength: hasTrigger(keywordTokens, hit) ? 2 : hasTrigger(emphasised, hit) ? 1 : 0 }]))).values()];
    results.push({ topic, hits: distinct, score, triggerTags });
  }
  return results.sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id));
}

export function localTagsFor(topicMatches, location) {
  if (!location?.city) return [];
  const city = location.city.replace(/[^\p{L}\p{N}]+/gu, "");
  const out = [];
  for (const match of topicMatches) {
    for (const template of match.topic.local || []) out.push(`#${template.replace(CITY_TEMPLATE, city)}`);
  }
  return [...new Set(out)];
}

export function emojiForItem(item, topicMatches = []) {
  const key = String(item).toLowerCase().trim();
  if (ITEM_EMOJI[key]) return ITEM_EMOJI[key];
  const words = key.split(/\s+/);
  for (const word of [...words].reverse()) if (ITEM_EMOJI[word]) return ITEM_EMOJI[word];
  for (const match of topicMatches) if (match.topic.triggers.some((trigger) => key.includes(trigger))) return match.topic.emoji;
  return "✅";
}
