/**
 * Leerer Ersatz fuer Nests optionale Peer-Pakete (EYT-142).
 *
 * `@nestjs/core` enthaelt `require("@nestjs/microservices")` &Co. hinter
 * Laufzeitweichen. Der Bundler loest sie statisch auf und bricht ab, obwohl die
 * Anwendung keines dieser Pakete nutzt. Ein leerer Stub ist ehrlicher als die
 * Pakete als Abhaengigkeit aufzunehmen, nur damit der Bundler ruhig ist.
 */
export default {};
