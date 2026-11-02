"""Bound write requests without retrying or bypassing GitHub's own quotas."""

from tracking_model import TrackingError


class WriteBudgetReached(TrackingError):
    pass


class BudgetedGh:
    def __init__(self, gh, limit=None):
        self.gh = gh
        self.limit = limit
        self.used = 0

    def check_write_available(self):
        if self.limit is not None and self.used >= self.limit:
            raise WriteBudgetReached("The configured write-request budget was reached")

    def consume_write(self):
        self.check_write_available()
        self.used += 1

    def request(self, method, path, body=None, **kwargs):
        if method != "GET":
            self.consume_write()
        return self.gh.request(method, path, body, **kwargs)

    def list(self, path):
        return self.gh.list(path)

    def graphql(self, query, variables=None):
        if query.lstrip().startswith("mutation"):
            self.consume_write()
        return self.gh.graphql(query, variables)
