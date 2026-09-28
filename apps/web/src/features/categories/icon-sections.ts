/**
 * The icon picker's shelves, and the words each icon answers to — plain data, so a test can hold every icon the app
 * draws to exactly one shelf and the search to the words people actually type (English and Indonesian both).
 */

export interface IconSection {
  title: string;
  keys: readonly string[];
}

export const ICON_SECTIONS: readonly IconSection[] = [
  {
    title: 'Food & drink',
    keys: ['utensils', 'utensils-crossed', 'coffee', 'cup-soda', 'beer', 'wine', 'pizza', 'soup', 'sandwich', 'ice-cream-cone', 'cake', 'chef-hat', 'shopping-basket'],
  },
  { title: 'Transport', keys: ['car', 'car-taxi-front', 'bus', 'bus-front', 'train-front', 'bike', 'ship', 'fuel', 'circle-parking', 'wrench', 'footprints'] },
  {
    title: 'Home & bills',
    keys: ['house', 'building', 'building-2', 'key-round', 'sofa', 'paint-roller', 'hammer', 'spray-can', 'washing-machine', 'bath', 'zap', 'flame', 'droplets', 'wifi', 'smartphone', 'trash-2', 'shield', 'receipt', 'mail', 'repeat'],
  },
  {
    title: 'Health & care',
    keys: ['heart-pulse', 'stethoscope', 'pill', 'pill-bottle', 'clipboard-plus', 'eye', 'siren', 'shield-plus', 'shield-check', 'shield-alert', 'heart-handshake', 'dumbbell', 'sparkles', 'scissors', 'flower-2', 'message-circle-heart', 'brain', 'cigarette'],
  },
  { title: 'Shopping', keys: ['shopping-bag', 'shopping-cart', 'shirt', 'watch', 'gem', 'laptop', 'cpu', 'blocks', 'book', 'package'] },
  {
    title: 'Money',
    keys: ['wallet', 'banknote', 'credit-card', 'piggy-bank', 'hand-coins', 'landmark', 'percent', 'badge-percent', 'trending-up', 'chart-line', 'chart-column', 'circle-plus', 'arrow-left-right', 'gavel', 'file-check', 'id-card'],
  },
  {
    title: 'Fun & travel',
    keys: ['plane', 'bed', 'map', 'map-pin', 'tent', 'tree-palm', 'ticket', 'film', 'clapperboard', 'gamepad-2', 'music', 'camera', 'drama', 'palette', 'brush', 'party-popper', 'trophy'],
  },
  { title: 'Family & pets', keys: ['baby', 'users', 'users-round', 'gift', 'flower', 'hand-heart', 'hand-helping', 'paw-print', 'dog', 'cat', 'church'] },
  { title: 'Work & learning', keys: ['briefcase', 'graduation-cap', 'school', 'book-open', 'presentation', 'file-text', 'pen-tool'] },
  { title: 'Other', keys: ['circle-ellipsis', 'circle-help'] },
];

/** Words an icon answers to besides its own name. Lowercase; Indonesian beside English where people would type it. */
export const ICON_WORDS: Readonly<Record<string, readonly string[]>> = {
  utensils: ['makan', 'food', 'restaurant', 'meal', 'eat'],
  'utensils-crossed': ['restaurant', 'restoran', 'dining', 'makan'],
  coffee: ['kopi', 'cafe', 'kafe', 'tea', 'teh'],
  'cup-soda': ['soda', 'drink', 'minum', 'boba', 'es'],
  beer: ['bir', 'bar', 'alcohol', 'drink'],
  wine: ['anggur', 'alcohol', 'bar'],
  pizza: ['fast food', 'snack'],
  soup: ['sup', 'soto', 'bakso', 'noodle', 'mie'],
  sandwich: ['snack', 'bekal', 'lunch', 'roti'],
  'ice-cream-cone': ['es krim', 'dessert', 'sweet'],
  cake: ['kue', 'birthday', 'ulang tahun', 'dessert'],
  'chef-hat': ['cook', 'masak', 'catering', 'katering'],
  'shopping-basket': ['groceries', 'belanja', 'pasar', 'market', 'sembako'],
  car: ['mobil', 'vehicle', 'kendaraan'],
  'car-taxi-front': ['taxi', 'taksi', 'ojek', 'grab', 'gojek', 'ride'],
  bus: ['bis', 'public transport', 'angkot', 'transjakarta'],
  'bus-front': ['bis', 'shuttle', 'antar jemput'],
  'train-front': ['kereta', 'krl', 'mrt', 'train', 'commuter'],
  bike: ['sepeda', 'motor', 'bicycle', 'cycling'],
  ship: ['kapal', 'ferry', 'boat', 'feri'],
  fuel: ['bensin', 'gas', 'petrol', 'bbm', 'pertamina'],
  'circle-parking': ['parkir', 'parking', 'toll', 'tol'],
  wrench: ['bengkel', 'service', 'servis', 'repair', 'maintenance'],
  footprints: ['walk', 'jalan', 'steps'],
  house: ['rumah', 'home', 'household'],
  building: ['gedung', 'apartment', 'apartemen', 'office'],
  'building-2': ['property', 'properti', 'apartment'],
  'key-round': ['rent', 'sewa', 'kos', 'kost'],
  sofa: ['furniture', 'perabot', 'decor'],
  'paint-roller': ['paint', 'cat', 'renovation', 'renovasi'],
  hammer: ['tukang', 'repair', 'perbaikan', 'tools'],
  'spray-can': ['cleaning', 'bersih', 'supplies'],
  'washing-machine': ['laundry', 'cuci', 'mesin cuci'],
  bath: ['mandi', 'bathroom', 'toiletries'],
  zap: ['listrik', 'electricity', 'pln', 'power'],
  flame: ['gas', 'elpiji', 'lpg', 'energy'],
  droplets: ['air', 'water', 'pdam'],
  wifi: ['internet', 'indihome', 'broadband'],
  smartphone: ['pulsa', 'phone', 'hp', 'mobile', 'data'],
  'trash-2': ['sampah', 'waste', 'garbage'],
  shield: ['security', 'keamanan', 'satpam'],
  receipt: ['bill', 'tagihan', 'tax', 'pajak'],
  mail: ['pos', 'post', 'postal', 'letter'],
  repeat: ['subscription', 'langganan', 'recurring'],
  'heart-pulse': ['health', 'sehat', 'kesehatan', 'medical'],
  stethoscope: ['doctor', 'dokter', 'clinic', 'klinik'],
  pill: ['obat', 'medicine', 'vitamin', 'supplement'],
  'pill-bottle': ['apotek', 'pharmacy', 'obat'],
  'clipboard-plus': ['check up', 'medical', 'lab'],
  eye: ['mata', 'glasses', 'kacamata', 'optik'],
  siren: ['emergency', 'darurat', 'ambulance'],
  'shield-plus': ['insurance', 'asuransi', 'bpjs'],
  'shield-check': ['insurance', 'asuransi', 'protection'],
  'shield-alert': ['insurance', 'asuransi', 'critical'],
  'heart-handshake': ['life insurance', 'asuransi jiwa', 'care'],
  dumbbell: ['gym', 'fitness', 'olahraga', 'sport'],
  sparkles: ['beauty', 'cantik', 'skincare', 'personal care'],
  scissors: ['haircut', 'potong rambut', 'salon', 'barber'],
  'flower-2': ['spa', 'wellness', 'massage', 'pijat'],
  'message-circle-heart': ['therapy', 'terapi', 'counselling', 'konseling'],
  brain: ['mind', 'self development', 'mental'],
  cigarette: ['rokok', 'smoke', 'vape'],
  'shopping-bag': ['belanja', 'shopping', 'mall'],
  'shopping-cart': ['cart', 'keranjang', 'supermarket', 'groceries', 'belanja bulanan'],
  cpu: ['tech', 'electronics', 'elektronik', 'gadget', 'komputer', 'computer', 'chip'],
  shirt: ['baju', 'clothes', 'pakaian', 'fashion', 'laundry'],
  watch: ['jam', 'accessories', 'aksesoris'],
  gem: ['perhiasan', 'jewelry', 'wedding', 'nikah'],
  laptop: ['komputer', 'computer', 'electronics', 'elektronik', 'gadget'],
  blocks: ['toys', 'mainan', 'lego'],
  book: ['buku', 'books', 'reading'],
  package: ['paket', 'delivery', 'takeaway', 'online'],
  wallet: ['dompet', 'cash', 'uang saku', 'pocket money'],
  banknote: ['uang', 'money', 'salary', 'gaji', 'cash'],
  'credit-card': ['kartu kredit', 'card', 'kartu', 'debit'],
  'piggy-bank': ['tabungan', 'savings', 'nabung'],
  'hand-coins': ['zakat', 'infaq', 'donation', 'sedekah'],
  landmark: ['bank', 'government', 'pemerintah', 'tax', 'pajak'],
  percent: ['interest', 'bunga', 'rate'],
  'badge-percent': ['fee', 'biaya', 'admin', 'cashback', 'diskon', 'discount'],
  'trending-up': ['investment', 'investasi', 'saham', 'stocks'],
  'chart-line': ['gains', 'profit', 'investment'],
  'chart-column': ['chart', 'bar', 'stocks', 'saham', 'investasi', 'investment'],
  'circle-plus': ['other income', 'lainnya', 'extra'],
  'arrow-left-right': ['transfer', 'kirim'],
  gavel: ['fine', 'denda', 'penalty', 'legal', 'hukum'],
  'file-check': ['document', 'dokumen', 'admin'],
  'id-card': ['membership', 'anggota', 'ktp', 'id'],
  plane: ['travel', 'liburan', 'flight', 'pesawat', 'holiday'],
  bed: ['hotel', 'penginapan', 'sleep', 'villa'],
  map: ['trip', 'field trip', 'wisata'],
  'map-pin': ['activities', 'place', 'tempat', 'tour'],
  tent: ['camping', 'kemah', 'recreation', 'rekreasi'],
  'tree-palm': ['beach', 'pantai', 'bali', 'holiday', 'liburan'],
  ticket: ['tiket', 'concert', 'konser', 'event'],
  film: ['movie', 'film', 'bioskop', 'cinema'],
  clapperboard: ['entertainment', 'hiburan', 'streaming'],
  'gamepad-2': ['game', 'gaming', 'main'],
  music: ['musik', 'spotify', 'lagu', 'song'],
  camera: ['kamera', 'photo', 'foto'],
  drama: ['theatre', 'teater', 'performance', 'pentas'],
  palette: ['art', 'seni', 'lukis', 'club'],
  brush: ['hobby', 'hobi', 'craft', 'kerajinan'],
  'party-popper': ['party', 'pesta', 'celebration', 'perayaan'],
  trophy: ['bonus', 'prize', 'hadiah', 'award'],
  baby: ['bayi', 'anak', 'child', 'kid', 'newborn'],
  users: ['family', 'keluarga', 'relatives', 'saudara'],
  'users-round': ['dependants', 'tanggungan', 'parents', 'orang tua'],
  gift: ['hadiah', 'kado', 'present'],
  flower: ['funeral', 'duka', 'bunga', 'flowers'],
  'hand-heart': ['charity', 'amal', 'donation', 'donasi'],
  'hand-helping': ['help', 'bantuan', 'maid', 'art', 'pembantu', 'services'],
  'paw-print': ['pet', 'hewan', 'peliharaan', 'vet'],
  dog: ['anjing', 'pet', 'hewan'],
  cat: ['kucing', 'pet', 'hewan'],
  church: ['gereja', 'masjid', 'mosque', 'worship', 'ibadah', 'religion'],
  briefcase: ['work', 'kerja', 'business', 'bisnis', 'office', 'kantor'],
  'graduation-cap': ['sekolah', 'school', 'education', 'pendidikan', 'kuliah', 'university'],
  school: ['sekolah', 'tuition', 'spp', 'uang sekolah'],
  'book-open': ['textbook', 'buku pelajaran', 'study', 'belajar'],
  presentation: ['course', 'kursus', 'les', 'lesson', 'class'],
  'file-text': ['administration', 'administrasi', 'paperwork'],
  'pen-tool': ['design', 'desain', 'stationery', 'alat tulis', 'freelance'],
  'circle-ellipsis': ['other', 'lainnya', 'misc', 'miscellaneous'],
  'circle-help': ['unknown', 'help'],
};

const words = (key: string): string[] => [key.replace(/-\d+$/, '').replace(/-/g, ' '), ...(ICON_WORDS[key] ?? [])];

/** Whether an icon answers to what was typed: any part of its name or its words, ignoring case and spacing. */
export function iconMatches(key: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return true;
  return words(key).some((word) => word.includes(q));
}

/** The shelves with only the icons that answer to `query`, empty shelves dropped. An empty query keeps every one. */
export function searchIcons(query: string): IconSection[] {
  return ICON_SECTIONS.map((section) => ({ title: section.title, keys: section.keys.filter((key) => iconMatches(key, query)) })).filter(
    (section) => section.keys.length > 0,
  );
}
