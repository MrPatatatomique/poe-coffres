//! Pont local pour la page Coffres (https://mrpatatatomique.github.io/poe-coffres/).
//! Version autonome (Windows, Linux, macOS) du pont intégré à l'overlay PoE.
//!
//! Le navigateur ne peut pas interroger lui-même le site de trade : la page
//! est sur un autre domaine (CORS) et le site exige une vérification Cloudflare
//! que les requêtes d'extension ne passent pas. L'overlay, client HTTP
//! ordinaire, le peut : ce pont relaie donc les requêtes de la page.
//!
//! Sécurité : écoute seulement sur 127.0.0.1, n'accepte que les pages
//! autorisées (en-tête Origin) et ne relaie que /api/trade/… vers
//! pathofexile.com. Les limites de requêtes du site sont renvoyées telles
//! quelles à la page, qui les respecte.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

/// Pages autorisées à utiliser le pont, en plus de localhost et des fichiers locaux.
const ORIGINS: &[&str] = &["https://mrpatatatomique.github.io"];
const UPSTREAM: &str = "https://www.pathofexile.com";
/// En-têtes du site transmis à la page (limites de requêtes).
const PASS: &[&str] = &[
    "retry-after",
    "x-rate-limit-policy",
    "x-rate-limit-rules",
    "x-rate-limit-ip",
    "x-rate-limit-ip-state",
    "x-rate-limit-account",
    "x-rate-limit-account-state",
];

fn origin_allowed(o: &str) -> bool {
    ORIGINS.contains(&o)
        || o == "null"
        || o == "http://localhost"
        || o.starts_with("http://localhost:")
        || o == "http://127.0.0.1"
        || o.starts_with("http://127.0.0.1:")
}

const UA: &str = concat!("poe-coffres-pont/", env!("CARGO_PKG_VERSION"), " (+https://github.com/MrPatatatomique/poe-coffres)");

fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|p| p.parse().ok()).unwrap_or(7777);
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Impossible d'ouvrir le port {port} : {e}");
            eprintln!("Le pont tourne peut-être déjà (ou l'overlay PoE l'utilise). Cette fenêtre se ferme dans 10 s.");
            std::thread::sleep(Duration::from_secs(10));
            std::process::exit(1);
        }
    };
    println!("Pont Coffres PoE1 v{} : en écoute sur http://127.0.0.1:{port}", env!("CARGO_PKG_VERSION"));
    println!("Laisse cette fenêtre ouverte (tu peux la réduire). La page Coffres l'utilise pour ses recherches trade.");
    let agent: ureq::Agent =
        ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).http_status_as_error(false).build().into();
    for stream in listener.incoming().flatten() {
        let agent = agent.clone();
        std::thread::spawn(move || {
            let _ = handle(stream, &agent, UA);
        });
    }
}

struct Request {
    method: String,
    path: String,
    origin: String,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> std::io::Result<Request> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut r = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let (mut origin, mut len) = (String::new(), 0usize);
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "origin" => origin = v.trim().to_string(),
                "content-length" => len = v.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
    }
    let mut body = vec![0; len.min(1 << 20)];
    r.read_exact(&mut body)?;
    Ok(Request { method, path, origin, body })
}

fn respond(stream: &mut TcpStream, status: u16, origin: &str, extra: &[(String, String)], body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        502 => "Bad Gateway",
        _ => "Status",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n",
        body.len()
    );
    if origin_allowed(origin) {
        head += &format!(
            "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nAccess-Control-Expose-Headers: {}\r\n",
            PASS.join(", ")
        );
    }
    for (k, v) in extra {
        head += &format!("{k}: {v}\r\n");
    }
    head += "\r\n";
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn handle(mut stream: TcpStream, agent: &ureq::Agent, ua: &str) -> std::io::Result<()> {
    let req = read_request(&stream)?;
    if !req.origin.is_empty() && !origin_allowed(&req.origin) {
        return respond(&mut stream, 403, "", &[], br#"{"error":"page non autorisee"}"#);
    }
    if req.method == "OPTIONS" {
        return respond(&mut stream, 204, &req.origin, &[], b"");
    }
    if req.path == "/health" {
        let b = format!(r#"{{"ok":true,"name":"poe-coffres-pont","version":"{}"}}"#, env!("CARGO_PKG_VERSION"));
        return respond(&mut stream, 200, &req.origin, &[], b.as_bytes());
    }
    if !req.path.starts_with("/api/trade/") || req.path.contains("..") {
        return respond(&mut stream, 404, &req.origin, &[], br#"{"error":"chemin refuse"}"#);
    }
    let url = format!("{UPSTREAM}{}", req.path);
    let short: String = req.path.split('?').next().unwrap_or_default().chars().take(60).collect();
    println!("{} {short}", req.method);
    let result = if req.method == "POST" {
        agent
            .post(&url)
            .header("User-Agent", ua)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .send(&req.body[..])
    } else {
        agent.get(&url).header("User-Agent", ua).header("Accept", "application/json").call()
    };
    match result {
        Ok(mut resp) => {
            let status = resp.status().as_u16();
            let extra: Vec<(String, String)> = PASS
                .iter()
                .filter_map(|h| resp.headers().get(*h).and_then(|v| v.to_str().ok()).map(|v| (h.to_string(), v.to_string())))
                .collect();
            let body = resp.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().unwrap_or_default();
            respond(&mut stream, status, &req.origin, &extra, &body)
        }
        Err(e) => {
            let msg = e.to_string().replace('\\', "/").replace('"', "'");
            respond(&mut stream, 502, &req.origin, &[], format!(r#"{{"error":"{msg}"}}"#).as_bytes())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_known_pages_may_use_the_bridge() {
        assert!(origin_allowed("https://mrpatatatomique.github.io"));
        assert!(origin_allowed("http://localhost:8765"));
        assert!(origin_allowed("null"));
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("http://localhost.evil.example"));
    }
}
