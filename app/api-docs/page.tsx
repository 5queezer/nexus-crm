"use client";

import "swagger-ui-react/swagger-ui.css";
import SwaggerUI from "swagger-ui-react";

export default function ApiDocsPage() {
  return (
    <main style={{ padding: "1rem" }}>
      <SwaggerUI url="/openapi.json" />
    </main>
  );
}
