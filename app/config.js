// Configurazione della sincronizzazione (facoltativa).
// Senza questi valori l'app funziona comunque, ma solo in locale su ogni dispositivo.
// La chiave "anon" di Supabase è pensata per stare nel browser: i dati sono
// protetti dalle regole di sicurezza per riga (vedi supabase/schema.sql).
window.CONFIG = {
  supabaseUrl: "",      // es. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",  // la chiave "anon public" del progetto
};
