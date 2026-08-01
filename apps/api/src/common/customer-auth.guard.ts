import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CustomerAuthService, type AuthenticatedCustomer } from './customer-auth.service.js';

export type CustomerRequest = FastifyRequest & {
  customerSession: AuthenticatedCustomer;
};

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    @Inject(CustomerAuthService)
    private readonly customerAuth: CustomerAuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const session = await this.customerAuth.requireSession(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      this.customerAuth.validateCsrf(request, session);
    }
    request.customerSession = session;
    return true;
  }
}
