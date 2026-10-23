//! The layers around every board route: the `Referer` policy, the Host guard
//! and the write guard.

use axum::extract::{Request, State};
use axum::http::{Method, header};
use axum::middleware::Next;
use axum::response::Response;

use super::GuardContext;
use crate::server::guard::{self, header_text};
use crate::server::response::{forbidden, page_out_of_date};

/// Every response tells the browser not to send a `Referer`.
pub(super) async fn no_referrer(request: Request, next: Next) -> Response {
    let private_api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    if private_api {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
    }
    response
}

/// Every request, whatever the path, needs an accepted `Host`.
pub(super) async fn host_guard(
    State(context): State<GuardContext>,
    request: Request,
    next: Next,
) -> Response {
    let host = header_text(request.headers(), "host");
    if guard::host_allowed(host, context.port) {
        next.run(request).await
    } else {
        forbidden("Open the board at http://127.0.0.1:<port>/ as printed by agboard serve.")
    }
}

/// Every request that changes data needs the page's Origin, Sec-Fetch-Site and
/// token. This runs before the path, the body or the shared files are looked at, so
/// a refusal never tells whether a project or task exists. `POST /api/notify`
/// changes nothing and is open.
pub(super) async fn write_guard(
    State(context): State<GuardContext>,
    request: Request,
    next: Next,
) -> Response {
    let reads = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    let allowed = guard::write_allowed(request.headers(), context.port, &context.token);
    if reads || request.uri().path() == "/api/notify" || allowed {
        next.run(request).await
    } else if request.headers().contains_key("x-agboard-token")
        && matches!(
            guard::write_refusal(request.headers(), context.port, &context.token),
            Some(guard::Denial::Token)
        )
    {
        page_out_of_date()
    } else {
        forbidden("Changes can only be made from the board page.")
    }
}
